/**
 * Nonogram multiplayer rooms client — RACE matches (Sudoku pattern).
 *
 * Match model (SQL contract, migration 002):
 *   no_matches columns: id, room_id, blue_id, red_id (seats 0/1, kept
 *   for hub compat), player_ids uuid[] (ORDERED seats, len 2-4),
 *   picture_id (pool id `s{size}t{tier}-{k}`, k = seed % 10 within the
 *   leader-chosen tier), size, tier, seed, progress jsonb keyed by
 *   user id {pct, mistakes, finished, finished_at, secs}, results
 *   jsonb {ranks[], xp[]} | null, result, reason, winner_id,
 *   tournament_id (dormant), created_at, finished_at.
 *   RPCs: no_create_room, no_join_room, no_leave_room, no_kick_member,
 *   no_set_member_role, no_set_turn_order, no_close_room,
 *   no_update_room_rules, no_set_room_public, no_delete_room,
 *   no_rematch (same seats/size/tier, fresh seed), no_cancel_room_match,
 *   no_list_public_rooms, no_room_leaderboard, no_preview_room,
 *   no_guest_room_detail, and the three race-flow RPCs:
 *     no_start_next_match(p_room_id, p_size, p_tier, p_players):
 *       leader-only; size/tier default from the room rules JSON;
 *       derives picture_id server-side from a fresh seed.
 *     no_update_progress(p_match_id, p_pct, p_mistakes, p_finished):
 *       merges ONLY the caller's progress row; pct is monotonic
 *       ('progress_regression'), a finish needs pct=100 plus the
 *       per-size minimum elapsed gate ('too_fast'). finished = SOLVED.
 *     no_finish_room_match(p_match_id): DERIVES ranks server-side
 *       (solvers by finish time, then fewer mistakes, then pct),
 *       settles XP 15/10/7/5 by rank + pairwise Elo, writes no_games
 *       history rows; idempotent; returns
 *       {play_xp, host_xp, daily_xp, ranks, winner_id}.
 */
import { createClient } from "./client";
import type { RaceProgress } from "./matchUtil";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface Room {
  id: string;
  code: string;
  name: string;
  leader_id: string;
  max_players: number;
  is_public: boolean;
  status: string;
  turn_order: string[];
  rules: string | null;
  created_at: string;
}

export interface MatchResults {
  /** Server-derived rank per seat (1-based). */
  ranks: number[];
  /** XP awarded per seat. */
  xp?: number[];
}

export interface RoomMatch {
  id: string;
  room_id: string;
  /** Seats 0/1 as user ids — hub compat (hub aggregators read these). */
  blue_id: string | null;
  red_id: string | null;
  /** Ordered user ids, length 2-4. Populated by normMatch from the
   *  row's `player_ids` column. */
  players: string[];
  /** The raw DB column (uuid[]) the seats live in. */
  player_ids?: string[] | null;
  results: MatchResults | null;
  /** Pool picture id every racer paints (`s{size}t{tier}-{k}`). */
  picture_id: string;
  size: number;
  tier: number;
  /** Seed that picked the picture (k = seed % 10 within the tier). */
  seed: number | null;
  status: string;
  result?: string | null;
  reason: string | null;
  winner_id: string | null;
  /** Per-user race progress rows (jsonb), keyed by user id. */
  progress: Record<string, RaceProgress> | null;
  tournament_id?: string | null;
  created_at?: string;
  finished_at?: string | null;
}

export interface RoomMember {
  user_id: string;
  role: string;
  joined_at: string;
  name: string;
  avatar_url: string | null;
}

export interface PublicRoom {
  id: string;
  code: string;
  name: string;
  member_count: number;
  max_players: number;
  has_active_match: boolean;
}

export interface HotRoom {
  room_id: string;
  name: string;
  code: string;
  matches_7d: number;
  member_count: number;
}

export interface RoomPreview {
  name: string;
  member_count: number;
  is_public: boolean;
  status: string;
  rules: string | null;
}

export interface GuestRoomDetail {
  id: string;
  code: string;
  name: string;
  max_players: number;
  status: string;
  rules: string | null;
  member_count: number;
  members: Array<{ name: string; role: string }>;
  active_match: {
    id: string;
    blue_id: string | null;
    red_id: string | null;
    /** Seat user ids, in order (the RPC's `player_ids`). */
    player_ids: string[];
    /** Display names in the same order as player_ids. */
    players: string[];
    /** The pool picture being raced + its size/tier; guests watch
     *  live progress bars from `progress` (design §6.3). */
    picture_id: string;
    size: number;
    tier: number;
    seed: number | null;
    progress: Record<string, RaceProgress> | null;
    status: string;
  } | null;
  comments: Array<{ user_name: string; body: string; created_at: string }>;
}

export interface RoomComment {
  id: string;
  room_id: string;
  match_id: string | null;
  move_number: number;
  user_id: string;
  body: string;
  created_at: string;
}

export interface XpEarned {
  play_xp: number;
  host_xp: number;
  daily_xp: number;
}

/** no_finish_room_match's jsonb return. */
export interface FinishResult extends XpEarned {
  ranks?: number[];
  winner_id?: string | null;
  already_finished?: boolean;
}

export interface MyRoomMatch {
  match: RoomMatch;
  roomName: string;
  roomCode: string;
  /** My seat index in match.players; -1 when only watching. */
  mySeat: number;
}

export const REACTIONS = ["👏", "🔥", "😱", "👍", "😮"];

/** Map an RPC error to a stable key the UI translates. */
export function roomErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  for (const key of [
    "room_not_found",
    "room_full",
    "room_closed",
    "not_authenticated",
    "not_leader",
    "leader_cannot_leave",
    "leader_must_play",
    "cannot_kick_self",
    "room_need_two_players",
    "match_in_progress",
    "match_not_found",
    "not_allowed",
    "not_enough_players",
    "tournament_in_progress",
    "tournament_finished",
    "tournament_not_found",
    "invalid_role",
  ]) {
    if (msg.includes(key)) return key;
  }
  return "generic";
}

export function displayName(p: {
  full_name?: string | null;
  username?: string | null;
}): string {
  return p.full_name || p.username || "Player";
}

/** Create a room via the no_create_room SECURITY DEFINER RPC
 *  (migration 005). The old direct INSERT + .select() read-back was
 *  invisible to its own creator under the rooms SELECT policy for
 *  PRIVATE rooms (leader not yet a member, room not public), so
 *  private-room creation — and every friend challenge — silently
 *  failed in production. The RPC inserts the room + leader member row
 *  atomically and returns the room. */
export async function createRoom(
  name: string,
  isPublic: boolean,
  maxPlayers = 8
): Promise<Room> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_create_room", {
    p_name: name,
    p_is_public: isPublic,
    p_max_players: maxPlayers,
  });
  if (error) throw error;
  return data as Room;
}

/** Join via the no_join_room RPC — a direct SELECT by code cannot
 *  see private rooms (member-only RLS), so joining must be server-side. */
export async function joinRoom(code: string): Promise<Room> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_join_room", {
    p_code: code.trim().toUpperCase(),
  });
  if (error) throw error;
  return data as Room;
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  return (data as Room) ?? null;
}

export async function listMyRooms(): Promise<Room[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("no_room_members")
    .select("room:no_rooms(*)")
    .eq("user_id", user.id);
  if (error) throw error;
  const rooms: Room[] = ((data ?? []) as Array<{ room: Room | null }>)
    .map((r) => r.room)
    // Closed rooms vanish from the member list too (the visibility
    // gate shared with no_list_public_rooms et al — this join query
    // shape can't filter server-side without changing the RPC
    // contract, so the filter lands here, CCT/CG/CN/CNG precedent).
    .filter((r): r is Room => !!r && r.status !== "closed");
  rooms.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return rooms;
}

export async function listPublicRooms(): Promise<PublicRoom[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_list_public_rooms");
  if (error) throw error;
  return (data ?? []) as PublicRoom[];
}

export async function fetchHotRooms(): Promise<HotRoom[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_room_leaderboard");
  if (error) throw error;
  return (data ?? []) as HotRoom[];
}

export async function previewRoom(code: string): Promise<RoomPreview | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_preview_room", {
    p_code: code.trim().toUpperCase(),
  });
  if (error || !data || (data as unknown[]).length === 0) return null;
  return (data as RoomPreview[])[0];
}

export async function guestRoomDetail(
  roomId: string
): Promise<GuestRoomDetail | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_guest_room_detail", {
    p_room_id: roomId,
  });
  if (error || !data) return null;
  return data as GuestRoomDetail;
}

export async function fetchRoomMembers(roomId: string): Promise<RoomMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("no_room_members")
    .select(
      "user_id, role, joined_at, user:profiles(full_name, username, avatar_url)"
    )
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      user_id: string;
      role: string;
      joined_at: string;
      user: {
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
      } | null;
    }>
  ).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    joined_at: m.joined_at,
    name: m.user ? displayName(m.user) : "Player",
    avatar_url: m.user?.avatar_url ?? null,
  }));
}

/** Display names for arbitrary profile ids (match players, opponents). */
export async function fetchNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .in("id", unique);
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    username: string | null;
  }>) {
    out[p.id] = displayName(p);
  }
  return out;
}

/* ------------------------- membership actions ------------------------- */

export async function leaveRoom(roomId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_leave_room", { p_room_id: roomId });
  if (error) throw error;
}

export async function kickMember(roomId: string, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_kick_member", {
    p_room_id: roomId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function setMemberRole(
  roomId: string,
  userId: string,
  role: "player" | "spectator"
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_set_member_role", {
    p_room_id: roomId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}

export async function setTurnOrder(
  roomId: string,
  order: string[]
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_set_turn_order", {
    p_room_id: roomId,
    p_order: order,
  });
  if (error) throw error;
}

export async function closeRoom(roomId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_close_room", { p_room_id: roomId });
  if (error) throw error;
}

/** Owner-only permanent room deletion (family pattern,
 *  references/room-delete.md): a guarded soft close via the
 *  no_delete_room RPC (migration 008). Unlike the legacy
 *  no_close_room, the RPC refuses while a race is active
 *  (match_in_progress) and is owner-only. */
export async function deleteRoom(roomId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_delete_room", { p_room_id: roomId });
  if (error) throw error;
}

export async function updateRoomRules(
  roomId: string,
  rules: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_update_room_rules", {
    p_room_id: roomId,
    p_rules: rules,
  });
  if (error) throw error;
}

export async function setRoomPublic(
  roomId: string,
  isPublic: boolean
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_set_room_public", {
    p_room_id: roomId,
    p_public: isPublic,
  });
  if (error) throw error;
}

/* ----------------------------- matches ----------------------------- */

function normMatch(m: RoomMatch): RoomMatch {
  // The DB column is `player_ids` (uuid[]); the client-facing field is
  // `players`. Without this mapping every seat lookup misses.
  if (!Array.isArray(m.players) && Array.isArray(m.player_ids))
    m.players = m.player_ids;
  if (!Array.isArray(m.players)) m.players = [];
  if (!m.progress || typeof m.progress !== "object") m.progress = {};
  if (typeof m.size !== "number") m.size = 10;
  if (typeof m.tier !== "number") m.tier = 2;
  if (typeof m.picture_id !== "string") m.picture_id = "";
  return m;
}

export async function getActiveMatch(roomId: string): Promise<RoomMatch | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_matches")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data ? normMatch(data as RoomMatch) : null;
}

export async function getMatchById(matchId: string): Promise<RoomMatch | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_matches")
    .select("*")
    .eq("id", matchId)
    .single();
  return data ? normMatch(data as RoomMatch) : null;
}

export async function getLastFinishedMatch(
  roomId: string
): Promise<RoomMatch | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_matches")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "finished")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data ? normMatch(data as RoomMatch) : null;
}

export async function fetchPastMatches(
  roomId: string,
  limit = 50
): Promise<RoomMatch[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_matches")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "finished")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as RoomMatch[]).map(normMatch);
}

/** Start the next race via RPC. With no player list, ALL seated
 *  (role='player') members race, 2-4 of them, ordered by the room's
 *  turn order. Size/tier default to the room rules on the server;
 *  pass them to override for this match. An explicit 2-4 player list
 *  (jsonb array of user ids) is supported for tournament pairings. */
export async function startNextMatch(
  roomId: string,
  opts?: { size?: number; tier?: number; players?: string[] | null }
): Promise<RoomMatch> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_start_next_match", {
    p_room_id: roomId,
    p_size: opts?.size ?? null,
    p_tier: opts?.tier ?? null,
    p_players: opts?.players ?? null,
  });
  if (error) throw error;
  return normMatch(data as RoomMatch);
}

/** Report my own race progress via RPC. The server validates that
 *  the caller is seated, enforces monotonic pct and the finish
 *  gates, and merges ONLY the caller's row. `finished` means SOLVED
 *  (pct must be 100) — busting out on mistakes is finished=false
 *  with the final pct. */
export async function updateRaceProgress(
  matchId: string,
  pct: number,
  mistakes: number,
  finished: boolean
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_update_progress", {
    p_match_id: matchId,
    p_pct: pct,
    p_mistakes: mistakes,
    p_finished: finished,
  });
  if (error) throw error;
}

/** Finish via RPC: the server DERIVES the ranks from the stored
 *  progress rows, settles XP/Elo and writes history — the client
 *  submits nothing but the match id. Idempotent: repeat calls
 *  return already_finished with zero XP. */
export async function finishRoomMatch(
  matchId: string
): Promise<FinishResult | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_finish_room_match", {
    p_match_id: matchId,
  });
  if (error) throw error;
  return (data as FinishResult) ?? null;
}

export async function cancelMatch(matchId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("no_cancel_room_match", {
    p_match_id: matchId,
  });
  if (error) throw error;
}

/** Rematch via RPC: same seats, size and tier, a FRESH seed (a new
 *  picture to race on). Any seated player of the finished match may
 *  start it — no leader needed. */
export async function startRematch(roomId: string): Promise<RoomMatch> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("no_rematch", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return normMatch(data as RoomMatch);
}

/** Finished room matches where I played — for the History section.
 *  Uses an array containment filter on `player_ids` so seats 2/3 count. */
export async function fetchMyRoomMatches(
  limit = 50
): Promise<MyRoomMatch[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("no_matches")
    .select("*")
    .eq("status", "finished")
    .filter("player_ids", "cs", `{${user.id}}`)
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  const matches = ((data ?? []) as RoomMatch[]).map(normMatch);
  if (matches.length === 0) return [];
  const roomIds = [...new Set(matches.map((m) => m.room_id))];
  const { data: roomRows } = await supabase
    .from("no_rooms")
    .select("id, name, code")
    .in("id", roomIds);
  const roomById = new Map(
    ((roomRows ?? []) as Array<{ id: string; name: string; code: string }>).map(
      (r) => [r.id, r]
    )
  );
  return matches.map(
    (m) =>
      ({
        match: m,
        roomName: roomById.get(m.room_id)?.name ?? "—",
        roomCode: roomById.get(m.room_id)?.code ?? "",
        mySeat: m.players.indexOf(user.id),
      } as MyRoomMatch)
  );
}

/* ----------------------------- comments ----------------------------- */

export async function fetchComments(roomId: string): Promise<RoomComment[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_room_comments")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as RoomComment[];
}

export async function postComment(
  roomId: string,
  matchId: string | null,
  body: string,
  moveNumber: number
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("no_room_comments").insert({
    room_id: roomId,
    match_id: matchId,
    move_number: moveNumber,
    user_id: user.id,
    body: body.slice(0, 500),
  });
  if (error) throw error;
}

/* ---------------------------- reactions ---------------------------- */

export interface MatchReaction {
  id: string;
  user_id: string;
  emoji: string;
}

export async function fetchReactions(
  matchId: string
): Promise<MatchReaction[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("no_match_reactions")
    .select("id, user_id, emoji")
    .eq("match_id", matchId);
  return (data ?? []) as MatchReaction[];
}

export async function react(matchId: string, emoji: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: match } = await supabase
    .from("no_matches")
    .select("room_id")
    .eq("id", matchId)
    .single();
  if (!match) throw new Error("Match not found");
  const { error } = await supabase.from("no_match_reactions").insert({
    room_id: (match as { room_id: string }).room_id,
    match_id: matchId,
    user_id: user.id,
    emoji,
  });
  if (error) throw error;
}

export async function unreact(matchId: string, emoji: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("no_match_reactions")
    .delete()
    .eq("match_id", matchId)
    .eq("user_id", user.id)
    .eq("emoji", emoji);
  if (error) throw error;
}

/** Realtime reaction INSERTs for one match — drives the emoji floaters
 *  over the board (PacClone pattern). Members receive events under the
 *  reactions RLS policy; guests need the anon-select policy (migration
 *  004) for public rooms. */
export function subscribeReactions(
  matchId: string,
  onEmoji: (emoji: string, id?: string) => void
): RealtimeChannel {
  const supabase = createClient();
  const ch = supabase
    .channel(`no-reactions:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "no_match_reactions",
        filter: `match_id=eq.${matchId}`,
      },
      (payload: { new: { emoji?: string; id?: string } }) => {
        if (payload.new?.emoji) onEmoji(payload.new.emoji, payload.new?.id);
      }
    );
  ch.subscribe();
  return ch;
}

/* ---------------------------- realtime ---------------------------- */

export interface SubscribeMatchOpts {
  /** Track this viewer on the match channel and report viewer counts. */
  onPresence?: (count: number) => void;
  /** Identity to track (falls back to "guest"). */
  userId?: string | null;
}

export function subscribeMatch(
  matchId: string,
  onUpdate: (m: RoomMatch) => void,
  opts?: SubscribeMatchOpts
): RealtimeChannel {
  const supabase = createClient();
  const ch = supabase
    .channel(`no-match:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "no_matches",
        filter: `id=eq.${matchId}`,
      },
      (payload: { new: RoomMatch }) =>
        onUpdate(normMatch(payload.new as RoomMatch))
    );
  if (opts?.onPresence) {
    const report = () => {
      const state = ch.presenceState();
      let n = 0;
      for (const presences of Object.values(state))
        n += (presences as unknown[]).length;
      opts.onPresence!(n);
    };
    ch.on("presence", { event: "sync" }, report);
  }
  ch.subscribe(async (status: string) => {
    if (status === "SUBSCRIBED" && opts?.onPresence) {
      try {
        await ch.track({ user_id: opts.userId ?? "guest", at: Date.now() });
      } catch {
        /* presence is best-effort */
      }
    }
  });
  return ch;
}

/**
 * Room-level match events: a new match INSERT (e.g. a rematch or a
 * tournament match) so the match view can switch to it without a refresh.
 */
export function subscribeRoomMatches(
  roomId: string,
  onInsert: (m: RoomMatch) => void
): RealtimeChannel {
  const supabase = createClient();
  return supabase
    .channel(`no-room-matches:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "no_matches",
        filter: `room_id=eq.${roomId}`,
      },
      (payload: { new: RoomMatch }) =>
        onInsert(normMatch(payload.new as RoomMatch))
    )
    .subscribe();
}

export interface SubscribeRoomOpts {
  myUserId: string | null;
  onChange: () => void;
  onKicked: () => void;
}

/** Room-level subscription: member changes (incl. being kicked),
 *  room updates — the detail screen refetches on any of these. */
export function subscribeRoom(
  roomId: string,
  opts: SubscribeRoomOpts
): RealtimeChannel {
  const supabase = createClient();
  return supabase
    .channel(`no-room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "no_room_members",
        filter: `room_id=eq.${roomId}`,
      },
      (payload: { eventType: string; old: { user_id?: string } }) => {
        if (
          payload.eventType === "DELETE" &&
          opts.myUserId &&
          payload.old?.user_id === opts.myUserId
        ) {
          opts.onKicked();
          return;
        }
        opts.onChange();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "no_rooms",
        filter: `id=eq.${roomId}`,
      },
      () => opts.onChange()
    )
    .subscribe();
}
