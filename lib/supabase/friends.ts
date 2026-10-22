/**
 * Friends (shared `friendships` table: user_id → friend_id one-way follow,
 * created by the xiangqi app — never created here) and per-game
 * challenges (`no_challenges`).
 */
import { createClient } from "./client";
import { createRoom, fetchNames, type Room } from "./rooms";
import { fireEvent } from "./notify";

export interface Friend {
  user_id: string;
  name: string;
  avatar_url: string | null;
  /** CCT XP from no_stats (world-readable) — drives the Lv chip. */
  xp: number;
  /** Elo rating from no_stats (migration 006); 800 before it lands. */
  rating: number;
}

/** Batch-fetch XP + rating for a set of users (friend/search rows). */
async function fetchXp(
  ids: string[]
): Promise<Map<string, { xp: number; rating: number }>> {
  const out = new Map<string, { xp: number; rating: number }>();
  if (ids.length === 0) return out;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("no_stats")
      .select("*")
      .in("user_id", ids);
    for (const r of (data ?? []) as Array<{
      user_id: string;
      xp: number;
      rating?: number | null;
    }>) {
      out.set(r.user_id, {
        xp: Number(r.xp) || 0,
        rating: Number(r.rating) || 800,
      });
    }
  } catch {
    /* stat chips are decorative */
  }
  return out;
}

export interface Challenge {
  id: string;
  room_id: string;
  room_code: string;
  challenger_id: string;
  challenged_id: string;
  status: string;
  created_at: string;
  challenger_name?: string;
  challenged_name?: string;
}

/** One-way follows of the given user, resolved to profile names. */
export async function listFriends(userId: string): Promise<Friend[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("friendships")
    .select(
      "friend_id, friend:profiles!friendships_friend_id_fkey(full_name, username, avatar_url)"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (
    (data ?? []) as unknown as Array<{
      friend_id: string;
      friend: {
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
      } | null;
    }>
  ).map((f) => {
    const p = f.friend;
    const name =
      p?.full_name?.trim() || p?.username?.trim() || "Player";
    return { user_id: f.friend_id, name, avatar_url: p?.avatar_url ?? null };
  });
  const xp = await fetchXp(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    ...r,
    xp: xp.get(r.user_id)?.xp ?? 0,
    rating: xp.get(r.user_id)?.rating ?? 800,
  }));
}

/** Search profiles by username/full_name. */
export async function searchUsers(
  query: string,
  excludeId: string,
  limit = 20
): Promise<Friend[]> {
  const supabase = createClient();
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
    .neq("id", excludeId)
    .limit(limit);
  if (error) throw error;
  const rows = (
    (data ?? []) as unknown as Array<{
      id: string;
      full_name: string | null;
      username: string | null;
      avatar_url: string | null;
    }>
  ).map((p) => ({
    user_id: p.id,
    name: p.full_name?.trim() || p.username?.trim() || "Player",
    avatar_url: p.avatar_url,
  }));
  const xp = await fetchXp(rows.map((r) => r.user_id));
  return rows.map((r) => ({
    ...r,
    xp: xp.get(r.user_id)?.xp ?? 0,
    rating: xp.get(r.user_id)?.rating ?? 800,
  }));
}

export async function follow(userId: string, friendId: string): Promise<void> {
  if (userId === friendId) return;
  const supabase = createClient();
  const { error } = await supabase.from("friendships").upsert(
    { user_id: userId, friend_id: friendId },
    { onConflict: "user_id,friend_id" }
  );
  if (error) throw error;
}

export async function unfollow(
  userId: string,
  friendId: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("user_id", userId)
    .eq("friend_id", friendId);
  if (error) throw error;
}

export async function isFollowing(
  userId: string,
  friendId: string
): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("friendships")
    .select("friend_id")
    .eq("user_id", userId)
    .eq("friend_id", friendId)
    .maybeSingle();
  return !!data;
}

/* --------------------------- challenges --------------------------- */

/**
 * Challenge flow: create a private 2-player room (challenger pre-added
 * via createRoom), then insert the challenge row carrying the denormalized
 * room_code — the challenged player isn't a member yet and rooms RLS
 * hides the room from them, so the code must travel with the challenge.
 */
export async function sendChallenge(
  challengedId: string,
  myName: string
): Promise<Challenge> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const room: Room = await createRoom(`⚔️ ${myName}`, false, 2);
  const { data, error } = await supabase
    .from("no_challenges")
    .insert({
      room_id: room.id,
      room_code: room.code,
      challenger_id: user.id,
      challenged_id: challengedId,
    })
    .select()
    .single();
  if (error) throw error;
  void fireEvent("challenge", {
    to: challengedId,
    room: room.code,
    from: myName,
    challenge: (data as { id: string }).id,
  });
  return data as Challenge;
}

/** Pending challenges split into incoming (to me) / outgoing (mine),
 *  with names resolved. No inner join to rooms (see sendChallenge). */
export async function fetchPendingChallenges(): Promise<{
  incoming: Challenge[];
  outgoing: Challenge[];
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { incoming: [], outgoing: [] };
  const { data, error } = await supabase
    .from("no_challenges")
    .select("*")
    .eq("status", "pending")
    .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Challenge[];
  const ids = [...new Set(rows.flatMap((c) => [c.challenger_id, c.challenged_id]))];
  const names = await fetchNames(ids);
  for (const c of rows) {
    c.challenger_name = names[c.challenger_id] ?? "Player";
    c.challenged_name = names[c.challenged_id] ?? "Player";
  }
  return {
    incoming: rows.filter((c) => c.challenged_id === user.id),
    outgoing: rows.filter((c) => c.challenger_id === user.id),
  };
}

export async function respondChallenge(
  id: string,
  accepted: boolean
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("no_challenges")
    .update({ status: accepted ? "accepted" : "declined" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}

export async function cancelChallenge(id: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("no_challenges")
    .delete()
    .eq("id", id)
    .eq("challenger_id", user.id)
    .eq("status", "pending");
  if (error) throw error;
}

/**
 * Live challenge events. INSERTs to me → onIncoming(row); UPDATEs of my
 * outgoing rows → onAccepted(challenge, challengedName) when accepted,
 * onDeclined(challengedName) when declined.
 */
export function subscribeChallenges(
  uid: string,
  onIncoming: (c: Challenge) => void,
  onDeclined: (challengedName: string) => void,
  onAccepted?: (c: Challenge, challengedName: string) => void
) {
  const supabase = createClient();
  return supabase
    .channel(`sud-challenges:${uid}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "no_challenges",
        filter: `challenged_id=eq.${uid}`,
      },
      async (payload: { new: Challenge }) => {
        const c = payload.new as Challenge;
        const names = await fetchNames([c.challenger_id]);
        c.challenger_name = names[c.challenger_id] ?? "Player";
        onIncoming(c);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "no_challenges",
        filter: `challenger_id=eq.${uid}`,
      },
      async (payload: { new: Challenge }) => {
        const c = payload.new as Challenge;
        if (c.status === "declined") {
          const names = await fetchNames([c.challenged_id]);
          onDeclined(names[c.challenged_id] ?? "Player");
        } else if (c.status === "accepted") {
          const names = await fetchNames([c.challenged_id]);
          onAccepted?.(c, names[c.challenged_id] ?? "Player");
        }
      }
    )
    .subscribe();
}
