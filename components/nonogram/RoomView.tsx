"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import { SizeTierSelect } from "./LevelSelect";
import { getPicture } from "@/lib/nonogram/pool";
import {
  createRoom,
  deleteRoom,
  fetchHotRooms,
  fetchNames,
  fetchPastMatches,
  fetchRoom,
  fetchRoomMembers,
  getActiveMatch,
  getLastFinishedMatch,
  joinRoom,
  kickMember,
  leaveRoom,
  listMyRooms,
  listPublicRooms,
  roomErrorKey,
  setMemberRole,
  setRoomPublic,
  setTurnOrder,
  startNextMatch,
  subscribeRoom,
  subscribeRoomMatches,
  updateRoomRules,
  type HotRoom,
  type PublicRoom,
  type Room,
  type RoomMatch,
  type RoomMember,
} from "@/lib/supabase/rooms";
import { SEAT_EMOJI } from "@/lib/supabase/matchUtil";
import { APP_URL } from "@/lib/nonogram/shareCard";
import { createClient } from "@/lib/supabase/client";
import { usePagination, Pagination } from "./Pagination";
import RoomMatchView from "./RoomMatchView";
import GuestRooms from "./GuestRooms";
import { FriendButton } from "./FriendsView";

interface RoomViewProps {
  lang: Lang;
  user: { id: string } | null;
  inviteCode: string | null;
  onConsumeInvite: () => void;
  onLogin: () => void;
  openRoomId?: string | null;
}

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** Local strings for the multiplayer match model (reported for i18n). */
const L = {
  vi: {
    matchSeats: "Trận đua gồm mọi người chơi (🎮) trong phòng — từ 2 đến 4 người. Tất cả cùng giải MỘT puzzle, ai giải đúng hoàn toàn trước là thắng.",
    seatCount: "{n} người chơi",
    topRank: "🏆 Hạng 1: {name}",
  },
  en: {
    matchSeats: "A race seats every player (🎮) in the room — 2 to 4 people. Everyone solves the SAME puzzle; the first fully-correct solve wins.",
    seatCount: "{n} players",
    topRank: "🏆 1st: {name}",
  },
} as const;

export function roomErrText(key: string, s: Record<string, string | string[]>): string {
  const map: Record<string, string> = {
    room_not_found: "roomErrNotFound",
    room_full: "roomErrFull",
    room_closed: "roomErrClosed",
    not_authenticated: "roomErrNotAuthenticated",
    not_leader: "roomErrNotLeader",
    leader_cannot_leave: "roomErrLeaderCannotLeave",
    leader_must_play: "roomErrLeaderMustPlay",
    cannot_kick_self: "roomErrCannotKickSelf",
    room_need_two_players: "roomErrNeedTwoPlayers",
    match_in_progress: "roomErrMatchInProgress",
    match_not_found: "roomErrMatchNotFound",
    not_allowed: "roomErrNotAllowed",
    not_enough_players: "roomErrNotEnoughPlayers",
    tournament_in_progress: "roomErrTournInProgress",
    tournament_finished: "roomErrTournFinished",
    tournament_not_found: "roomErrTournNotFound",
    invalid_role: "roomErrInvalidRole",
  };
  return String(s[map[key] ?? "roomErrGeneric"] ?? s.roomErrGeneric);
}

function fmtDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-US");
}

export default function RoomView({
  lang,
  user,
  inviteCode,
  onConsumeInvite,
  onLogin,
  openRoomId,
}: RoomViewProps) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [roomId, setRoomId] = useState<string | null>(openRoomId ?? null);
  const [tab, setTab] = useState<"mine" | "public" | "hot">("mine");
  const [myRooms, setMyRooms] = useState<Room[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [hotRooms, setHotRooms] = useState<HotRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // create form
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [isPublic, setIsPublic] = useState(false);
  // join form
  const [code, setCode] = useState("");
  const inviteConsumed = useRef<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [mine, pub, hot] = await Promise.all([
        listMyRooms().catch(() => [] as Room[]),
        listPublicRooms().catch(() => [] as PublicRoom[]),
        fetchHotRooms().catch(() => [] as HotRoom[]),
      ]);
      setMyRooms(mine);
      setPublicRooms(pub);
      setHotRooms(hot);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadLists();
  }, [user, loadLists]);

  // Deep-link / challenge entry point from the parent.
  useEffect(() => {
    if (openRoomId && openRoomId !== roomId) setRoomId(openRoomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRoomId]);

  // Invite code while logged in (e.g. logged in from the guest invite
  // card): join and open the room, then consume the code.
  useEffect(() => {
    if (!user || !inviteCode || inviteConsumed.current === inviteCode) return;
    inviteConsumed.current = inviteCode;
    (async () => {
      setError(null);
      try {
        const room = await joinRoom(inviteCode);
        setRoomId(room.id);
      } catch (e) {
        setError(roomErrText(roomErrorKey(e), s));
      } finally {
        onConsumeInvite();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, inviteCode]);

  if (!user) {
    return <GuestRooms lang={lang} inviteCode={inviteCode} onLogin={onLogin} />;
  }

  if (roomId) {
    return (
      <RoomDetail
        roomId={roomId}
        lang={lang}
        userId={user.id}
        onBack={() => {
          setRoomId(null);
          void loadLists();
        }}
      />
    );
  }

  const doCreate = async () => {
    setError(null);
    try {
      const room = await createRoom(
        name.trim().slice(0, 60) || (lang === "vi" ? "Phòng chơi" : "Game room"),
        isPublic,
        maxPlayers
      );
      setName("");
      setRoomId(room.id);
    } catch (e) {
      setError(roomErrText(roomErrorKey(e), s));
    }
  };

  const doJoin = async () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{6}$/.test(c)) {
      setError(roomErrText("room_not_found", s));
      return;
    }
    setError(null);
    try {
      const room = await joinRoom(c);
      setCode("");
      setRoomId(room.id);
    } catch (e) {
      setError(roomErrText(roomErrorKey(e), s));
    }
  };

  const roomRow = (r: { id: string; name: string; member_count?: number; max_players?: number; has_active_match?: boolean; matches_7d?: number }, key: string) => (
    <li key={key}>
      <button
        type="button"
        className="sud-room-row-btn"
        onClick={() => setRoomId(r.id)}
      >
        <span className="sud-lb-name">
          {r.has_active_match ? (
            <span className="sud-live-badge">{String(s.roomLive)}</span>
          ) : null}{" "}
          {r.name}
        </span>
        <span className="sud-hint">
          {r.member_count ?? ""}
          {r.max_players ? `/${r.max_players}` : ""}
          {r.matches_7d !== undefined ? ` · ${r.matches_7d} ⚔️` : ""}
        </span>
      </button>
    </li>
  );

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>{String(s.room)}</h2>
        {error && <p className="sud-setup-error">{error}</p>}

        <div className="sud-panel">
          <h3>{String(s.roomCreate)}</h3>
          <label className="sud-field">
            {String(s.roomName)}
            <input
              className="sud-input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={String(s.roomNamePlaceholder)}
            />
          </label>
          <label className="sud-field">
            {String(s.roomMaxPlayers)}
            <select
              className="sud-select"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            >
              {MAX_PLAYERS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="sud-check-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            {String(s.roomPublic)}
          </label>
          <div className="sud-actions">
            <button
              className="sud-btn sud-btn-primary"
              onClick={doCreate}
            >
              {String(s.roomCreateBtn)}
            </button>
          </div>
        </div>

        <div className="sud-panel">
          <h3>{String(s.roomJoinTitle)}</h3>
          <div className="sud-comment-form">
            <input
              className="sud-input sud-code-input"
              value={code}
              maxLength={6}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
              placeholder={String(s.roomJoinCode)}
            />
            <button className="sud-btn small" onClick={doJoin}>
              {String(s.roomJoinBtn)}
            </button>
          </div>
        </div>

        <div className="sud-tabs">
          <button
            type="button"
            className={tab === "mine" ? "active" : ""}
            onClick={() => setTab("mine")}
          >
            {String(s.roomMyRooms)}
          </button>
          <button
            type="button"
            className={tab === "public" ? "active" : ""}
            onClick={() => setTab("public")}
          >
            {String(s.roomPublicLobby)}
          </button>
          <button
            type="button"
            className={tab === "hot" ? "active" : ""}
            onClick={() => setTab("hot")}
          >
            {String(s.roomHotRooms)}
          </button>
        </div>

        {loading ? (
          <p className="sud-empty-note">…</p>
        ) : (
          <>
            {tab === "mine" &&
              (myRooms.length === 0 ? (
                <p className="sud-empty-note">{String(s.roomNoRooms)}</p>
              ) : (
                <ul className="sud-board-list">
                  {myRooms.map((r) =>
                    roomRow(
                      {
                        id: r.id,
                        name: r.name,
                        max_players: r.max_players,
                      },
                      r.id
                    )
                  )}
                </ul>
              ))}
            {tab === "public" &&
              (publicRooms.length === 0 ? (
                <p className="sud-empty-note">{String(s.roomNoRooms)}</p>
              ) : (
                <ul className="sud-board-list">
                  {publicRooms.map((r) => roomRow(r, r.id))}
                </ul>
              ))}
            {tab === "hot" &&
              (hotRooms.length === 0 ? (
                <p className="sud-empty-note">{String(s.roomNoRooms)}</p>
              ) : (
                <ul className="sud-board-list">
                  {hotRooms.map((r) =>
                    roomRow(
                      {
                        id: r.room_id,
                        name: r.name,
                        member_count: r.member_count,
                        matches_7d: r.matches_7d,
                      },
                      r.room_id
                    )
                  )}
                </ul>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================ RoomDetail ============================ */

function RoomDetail({
  roomId,
  lang,
  userId,
  onBack,
}: {
  roomId: string;
  lang: Lang;
  userId: string;
  onBack: () => void;
}) {
  const s = STR[lang] as Record<string, string | string[]>;
  // L ships vi/en only: VI for Vietnamese, EN for every other locale
  // (the family fallback).
  const t = L[lang === "vi" ? "vi" : "en"];
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [activeMatch, setActiveMatch] = useState<RoomMatch | null>(null);
  const [viewedMatch, setViewedMatch] = useState<RoomMatch | null>(null);
  const [pastMatches, setPastMatches] = useState<RoomMatch[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tierDraft, setTierDraft] = useState(2);
  const [sizeDraft, setSizeDraft] = useState<5 | 10 | 15>(10);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const initialized = useRef(false);
  // A match the user deliberately exited (← back to lobby): polling
  // must not yank them straight back in. A NEW match still follows.
  const dismissedMatchId = useRef<string | null>(null);
  const { page, pageCount, pageItems, setPage } = usePagination(pastMatches, 10);

  const load = useCallback(async () => {
    try {
      const [r, ms, active, past] = await Promise.all([
        fetchRoom(roomId),
        fetchRoomMembers(roomId),
        getActiveMatch(roomId),
        fetchPastMatches(roomId, 50),
      ]);
      setRoom(r);
      // The owner's delete (status='closed') propagates live via the
      // rooms realtime UPDATE: members inside see the deleted notice
      // screen instead of a silent exit.
      if (r && r.status === "closed") {
        setDeleted(true);
        return;
      }
      setMembers(ms);
      setActiveMatch(active);
      if (active && dismissedMatchId.current !== active.id) {
        // Follow only from the lobby (prev === null): never yank a
        // user who is watching a finished match or another view.
        setViewedMatch((prev) => (prev ? prev : active));
      }
      setPastMatches(past);
      if (r) {
        try {
          const parsed = JSON.parse(r.rules ?? "{}") as { size?: number; tier?: number };
          if (parsed.tier && parsed.tier >= 1 && parsed.tier <= 3) setTierDraft(parsed.tier);
          if (parsed.size === 5 || parsed.size === 10 || parsed.size === 15)
            setSizeDraft(parsed.size);
        } catch {
          /* legacy free-text rules — default tier stays */
        }
      }
      const ids = new Set<string>();
      for (const m of ms) ids.add(m.user_id);
      if (r) {
        for (const id of r.turn_order) ids.add(id);
        if (r.leader_id) ids.add(r.leader_id);
      }
      const all = [active, ...past].filter(Boolean) as RoomMatch[];
      for (const m of all) for (const id of m.players) ids.add(id);
      const n = await fetchNames([...ids]).catch(() => ({}));
      setNames(n);
      if (!initialized.current) {
        initialized.current = true;
        if (active) {
          setViewedMatch(active);
        } else {
          const last = await getLastFinishedMatch(roomId).catch(() => null);
          if (last) setViewedMatch(last);
        }
      }
    } catch {
      /* polling/load is best-effort */
    }
  }, [roomId]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 4000);
    const chRoom = subscribeRoom(roomId, {
      myUserId: userId,
      onChange: () => void load(),
      onKicked: () => setKicked(true),
    });
    const chMatches = subscribeRoomMatches(roomId, (m) => {
      // Auto-follow a brand-new match (start / rematch / tournament).
      setActiveMatch(m.status === "active" ? m : null);
      setViewedMatch(m);
      void load();
    });
    return () => {
      clearInterval(timer);
      try {
        const c = createClient();
        c.removeChannel(chRoom);
        c.removeChannel(chMatches);
      } catch {
        /* ignore */
      }
    };
  }, [roomId, userId, load]);

  if (kicked) {
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <div className="sud-panel">
            <p>{String(s.roomKicked)}</p>
            <button className="sud-btn" onClick={onBack}>
              {String(s.roomBackToRoom)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (deleted) {
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <div className="sud-panel">
            <p>🗑 {String(s.roomDeletedNotice)}</p>
            <button className="sud-btn" onClick={onBack}>
              {String(s.roomBackToRoom)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <p className="sud-empty-note">…</p>
        </div>
      </div>
    );
  }

  const isLeader = room.leader_id === userId;
  const roomTier = (() => {
    try {
      const parsed = JSON.parse(room.rules ?? "{}") as { tier?: number };
      return parsed.tier && parsed.tier >= 1 && parsed.tier <= 3 ? parsed.tier : 2;
    } catch {
      return 2;
    }
  })();
  const roomSize = (() => {
    try {
      const parsed = JSON.parse(room.rules ?? "{}") as { size?: number };
      return parsed.size === 5 || parsed.size === 10 || parsed.size === 15
        ? parsed.size
        : 10;
    } catch {
      return 10;
    }
  })();
  const myMember = members.find((m) => m.user_id === userId);
  const seated = members.filter((m) => m.role === "player");
  const seatedCount = seated.length;
  const canStart = seatedCount >= 2 && seatedCount <= 4;

  const handleMatchChange = (m: RoomMatch) => {
    setViewedMatch(m);
    setActiveMatch((prev) => {
      if (m.status === "active") return m;
      return prev && prev.id === m.id ? null : prev;
    });
  };

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  const inviteLink = `${APP_URL}/?room=${room.code}`;

  const act = async (fn: () => Promise<unknown>, key?: string) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(key ? roomErrText(roomErrorKey(e), s) : String(s.roomErrGeneric));
    }
  };

  const moveInOrder = (uid: string, dir: -1 | 1) => {
    const order = [...(room.turn_order ?? [])];
    const i = order.indexOf(uid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void act(() => setTurnOrder(roomId, order));
  };

  const matchNames = (m: RoomMatch): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const uid of m.players) out[uid] = names[uid] ?? "…";
    return out;
  };

  const matchTitle = (m: RoomMatch) =>
    m.players.map((uid, seat) => `${SEAT_EMOJI[seat] ?? ""}${names[uid] ?? "…"}`).join(" vs ");

  const resultIcon = (m: RoomMatch) => {
    if (!m.results) return "⚔️";
    const top = Math.min(...m.results.ranks);
    const topCount = m.results.ranks.filter((r) => r === top).length;
    return topCount > 1 ? "🤝" : "🏆";
  };

  const matchSubtitle = (m: RoomMatch) => {
    if (!m.results) return "";
    const top = Math.min(...m.results.ranks);
    const winners = m.players.filter((_, seat) => m.results!.ranks[seat] === top);
    return t.topRank.replace("{name}", winners.map((u) => names[u] ?? "…").join(", "));
  };

  // Full-bleed match view (a direct child of .sud-page, like PlayView)
  // so the board's aspect-locked sizing gets a definite height. Nesting
  // .sud-layout inside .sud-view breaks the height:100% chain and the
  // board collapses/letterboxes.
  if (viewedMatch) {
    return (
      <RoomMatchView
        key={viewedMatch.id}
        match={viewedMatch}
        roomId={roomId}
        lang={lang}
        userId={userId}
        guest={false}
        member={!!myMember}
        names={matchNames(viewedMatch)}
        onExit={() => {
          dismissedMatchId.current = viewedMatch.id;
          setViewedMatch(null);
        }}
        onMatchChange={handleMatchChange}
      />
    );
  }

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <button type="button" className="sud-btn small" onClick={onBack}>
          {String(s.roomBackToRoom)}
        </button>
        <h2>{room.name}</h2>
        {error && <p className="sud-setup-error">{error}</p>}
        {room.status === "closed" && (
          <p className="sud-hint">🔒 {String(s.roomErrClosed)}</p>
        )}
        {!myMember && room.status !== "closed" && (
          <div className="sud-panel">
            <p className="sud-hint">{String(s.roomJoinThisHint)}</p>
            <div className="sud-actions">
              <button
                type="button"
                className="sud-btn sud-btn-primary"
                onClick={() => act(() => joinRoom(room.code), "join")}
              >
                {String(s.roomJoinThisRoom)}
              </button>
            </div>
          </div>
        )}

        <>
          {activeMatch && (
              <div className="sud-panel">
                <div className="sud-lb-row">
                  <span className="sud-lb-name">
                    <span className="sud-live-badge">
                      {String(s.roomLive)}
                    </span>{" "}
                    {matchTitle(activeMatch)}
                  </span>
                  <button
                    type="button"
                    className="sud-btn small sud-btn-primary"
                    onClick={() => setViewedMatch(activeMatch)}
                  >
                    ▶
                  </button>
                </div>
              </div>
            )}

            <div className="sud-panel sud-room-code-card">
              <div className="sud-room-code-big">{room.code}</div>
              <div className="sud-actions">
                <button
                  type="button"
                  className="sud-btn small"
                  onClick={() => copy(room.code)}
                >
                  {String(s.roomCopyCode)}
                </button>
                <button
                  type="button"
                  className="sud-btn small"
                  onClick={() => copy(inviteLink)}
                >
                  {String(s.roomCopyLink)}
                </button>
              </div>
              {copied && <p className="sud-hint">{String(s.roomCopied)}</p>}
            </div>

            <div className="sud-panel">
              <h3>
                {String(s.roomRules)} · {String(s.sudRaceTier)}
              </h3>
              {isLeader ? (
                <>
                  <SizeTierSelect
                    size={sizeDraft}
                    tier={tierDraft as 1 | 2 | 3}
                    onSize={(sz) => {
                      setSizeDraft(sz);
                      setRulesSaved(false);
                    }}
                    onTier={(tr) => {
                      setTierDraft(tr);
                      setRulesSaved(false);
                    }}
                    sizeLabel={String(s.noSizeLabel)}
                    tierLabel={String(s.sudTierLabel)}
                    tierNames={(s.sudTierNames as string[]) ?? []}
                  />
                  <div className="sud-actions">
                    <button
                      type="button"
                      className="sud-btn small"
                      onClick={() =>
                        act(() =>
                          updateRoomRules(
                            roomId,
                            JSON.stringify({ size: sizeDraft, tier: tierDraft })
                          )
                        ).then(() => setRulesSaved(true))
                      }
                    >
                      {String(s.roomSave)}
                    </button>
                    {rulesSaved && (
                      <span className="sud-hint">
                        {String(s.roomRulesSaved)}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="sud-hint">
                  {roomSize}×{roomSize} ·{" "}
                  {(s.sudTierNames as string[])[roomTier] ?? "—"}
                </p>
              )}
            </div>

            <div className="sud-panel">
              <h3>
                👥 {String(s.roomTurnOrder)} ({members.length}/{room.max_players})
              </h3>
              <p className="sud-hint">{String(s.roomTurnOrderHint)}</p>
              <ul className="sud-member-list">
                {members.map((m) => {
                  const pos = (room.turn_order ?? []).indexOf(m.user_id);
                  const other = m.user_id !== userId;
                  return (
                    <li key={m.user_id} className="sud-lb-row">
                      <span className="sud-lb-name">
                        {m.user_id === room.leader_id && (
                          <span title={String(s.roomLeader)}>👑 </span>
                        )}
                        {pos >= 0 && (
                          <span className="sud-hint">#{pos + 1} </span>
                        )}
                        {m.role === "spectator" ? "👀 " : ""}
                        {names[m.user_id] ?? "…"}
                        <span className="sud-hint">
                          {" "}
                          ·{" "}
                          {m.role === "player"
                            ? String(s.roomPlayer)
                            : String(s.roomSpectator)}
                        </span>
                      </span>
                      <span className="sud-row-actions">
                        {other && (
                          <FriendButton
                            lang={lang}
                            userId={userId}
                            otherId={m.user_id}
                          />
                        )}
                        {isLeader && other && (
                          <>
                            <button
                              type="button"
                              className="sud-btn small sud-btn-icon"
                              title="▲"
                              onClick={() => moveInOrder(m.user_id, -1)}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="sud-btn small sud-btn-icon"
                              title="▼"
                              onClick={() => moveInOrder(m.user_id, 1)}
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className="sud-btn small"
                              title={
                                m.role === "player"
                                  ? String(s.roomMakeSpectator)
                                  : String(s.roomMakePlayer)
                              }
                              onClick={() =>
                                act(() =>
                                  setMemberRole(
                                    roomId,
                                    m.user_id,
                                    m.role === "player"
                                      ? "spectator"
                                      : "player"
                                  )
                                )
                              }
                            >
                              {m.role === "player" ? "👀" : "🎮"}
                            </button>
                            <button
                              type="button"
                              className="sud-btn small"
                              title={String(s.roomKick)}
                              onClick={() =>
                                act(() => kickMember(roomId, m.user_id))
                              }
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="sud-panel">
              <p className="sud-hint">{t.matchSeats}</p>
              <p className="sud-hint">
                {t.seatCount.replace("{n}", String(seatedCount))}
                {seatedCount > 0 && `: ${seated.map((m) => names[m.user_id] ?? "…").join(", ")}`}
              </p>
              <div className="sud-actions">
                {isLeader ? (
                  <>
                    <button
                      type="button"
                      className="sud-btn sud-btn-primary"
                      disabled={!!activeMatch || room.status === "closed" || !canStart}
                      onClick={() =>
                        act(async () => {
                          const m = await startNextMatch(roomId);
                          dismissedMatchId.current = null;
                          setActiveMatch(m);
                          setViewedMatch(m);
                        }, "start")
                      }
                    >
                      {String(s.roomStartMatch)}
                    </button>
                    <button
                      type="button"
                      className="sud-btn small"
                      onClick={() =>
                        act(() => setRoomPublic(roomId, !room.is_public))
                      }
                    >
                      {room.is_public ? "🔒" : "🌐"}{" "}
                      {String(s.roomPublic).replace("🌐 ", "")}
                    </button>
                    <button
                      type="button"
                      className={`sud-btn small${
                        deleteArmed ? " sud-btn-danger" : ""
                      }`}
                      onClick={() => {
                        if (!deleteArmed) {
                          setDeleteArmed(true);
                          setTimeout(() => setDeleteArmed(false), 3500);
                          return;
                        }
                        setDeleteArmed(false);
                        // Delete (guarded soft close) replaces the
                        // old close control: owner-only, blocked
                        // while a race is active. The owner returns
                        // to the rooms list directly; members inside
                        // get the deleted notice via load().
                        void act(async () => {
                          await deleteRoom(roomId);
                          onBack();
                        }, "delete");
                      }}
                    >
                      {deleteArmed
                        ? String(s.roomDeleteConfirm)
                        : String(s.roomDelete)}
                    </button>
                  </>
                ) : (
                  myMember && (
                    <button
                      type="button"
                      className={`sud-btn small${
                        leaveArmed ? " sud-btn-danger" : ""
                      }`}
                      onClick={() => {
                        if (!leaveArmed) {
                          setLeaveArmed(true);
                          setTimeout(() => setLeaveArmed(false), 3500);
                          return;
                        }
                        setLeaveArmed(false);
                        act(() => leaveRoom(roomId)).then(onBack);
                      }}
                    >
                      {leaveArmed
                        ? String(s.roomLeaveConfirm)
                        : String(s.roomLeave)}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="sud-panel">
              <h3>{String(s.roomPastMatches)}</h3>
              {pastMatches.length === 0 ? (
                <p className="sud-empty-note">{String(s.roomMatchEmpty)}</p>
              ) : (
                <>
                  <ul className="sud-board-list">
                    {pageItems.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="sud-room-row-btn"
                          onClick={() => setViewedMatch(m)}
                        >
                          <span className="sud-lb-name">
                            {resultIcon(m)} {matchTitle(m)}
                          </span>
                          <span className="sud-hint">
                            {matchSubtitle(m)}{" "}
                            · {m.size}×{m.size} ·{" "}
                            {(s.sudTierNames as string[])[m.tier] ?? ""}
                            · {fmtDate(m.finished_at ?? m.created_at ?? "", lang)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={page}
                    pageCount={pageCount}
                    onPage={setPage}
                  />
                </>
              )}
            </div>
          </>
      </div>
    </div>
  );
}
