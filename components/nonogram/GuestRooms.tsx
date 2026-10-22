"use client";

import { useEffect, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  fetchHotRooms,
  guestRoomDetail,
  listPublicRooms,
  previewRoom,
  type GuestRoomDetail,
  type HotRoom,
  type PublicRoom,
  type RoomMatch,
  type RoomPreview,
} from "@/lib/supabase/rooms";
import RoomMatchView from "./RoomMatchView";

interface Props {
  lang: Lang;
  inviteCode: string | null;
  onLogin: () => void;
}

function fmtDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-US");
}

export default function GuestRooms({ lang, inviteCode, onLogin }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [invite, setInvite] = useState<RoomPreview | null>(null);
  const [inviteChecked, setInviteChecked] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [hotRooms, setHotRooms] = useState<HotRoom[]>([]);
  const [detail, setDetail] = useState<GuestRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [pub, hot] = await Promise.all([
          listPublicRooms().catch(() => [] as PublicRoom[]),
          fetchHotRooms().catch(() => [] as HotRoom[]),
        ]);
        if (!dead) {
          setPublicRooms(pub);
          setHotRooms(hot);
        }
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!inviteCode) {
      setInviteChecked(true);
      return;
    }
    let dead = false;
    (async () => {
      try {
        const p = await previewRoom(inviteCode).catch(() => null);
        if (!dead) setInvite(p);
      } finally {
        if (!dead) setInviteChecked(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [inviteCode]);

  const openDetail = async (roomId: string) => {
    const d = await guestRoomDetail(roomId).catch(() => null);
    if (d) setDetail(d);
  };

  // While a room detail is open, keep the race progress live: the
  // detail RPC is the guests' only window into the match.
  useEffect(() => {
    if (!detail) return;
    const id = detail.id;
    const timer = setInterval(() => {
      guestRoomDetail(id)
        .then((d) => {
          if (d) setDetail(d);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // Guest view of the active match: construct a RoomMatch from the jsonb.
  const guestMatch: RoomMatch | null =
    detail?.active_match != null
      ? {
          id: detail.active_match.id,
          room_id: detail.id,
          blue_id: detail.active_match.blue_id,
          red_id: detail.active_match.red_id,
          players: detail.active_match.player_ids ?? [],
          results: null,
          picture_id: detail.active_match.picture_id ?? "",
          size: detail.active_match.size ?? 10,
          seed: detail.active_match.seed ?? null,
          tier: detail.active_match.tier ?? 2,
          progress: detail.active_match.progress ?? {},
          status: detail.active_match.status,
          reason: null,
          winner_id: null,
        }
      : null;

  if (detail) {
    const guestNames: Record<string, string> = {};
    (detail.active_match?.player_ids ?? []).forEach((uid, i) => {
      guestNames[uid] = detail.active_match!.players[i] ?? "…";
    });
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <button
            type="button"
            className="sud-btn small"
            onClick={() => setDetail(null)}
          >
            {String(s.roomBackToRoom)}
          </button>
          <h2>{detail.name}</h2>
          <div className="sud-room-code-card">
            <span className="sud-hint">
              👥 {detail.member_count} {String(s.roomMembersCount)}
            </span>
          </div>
          <div className="sud-guest-banner">{String(s.guestSpectateBanner)}</div>
          {detail.rules && (
            <div className="sud-panel">
              <h3>{String(s.roomRules)}</h3>
              <p className="sud-hint">{detail.rules}</p>
            </div>
          )}
          <div className="sud-panel">
            <h3>👑 {String(s.roomLeader)}</h3>
            <ul className="sud-member-list">
              {detail.members.map((m, i) => (
                <li key={i} className="sud-lb-row">
                  <span className="sud-lb-name">
                    {m.role === "player" ? "" : "👀 "}
                    {m.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {guestMatch ? (
            <RoomMatchView
              match={guestMatch}
              roomId={detail.id}
              lang={lang}
              userId={null}
              guest={true}
              member={false}
              names={guestNames}
              onExit={() => setDetail(null)}
              onMatchChange={() => {}}
              onRequireLogin={onLogin}
            />
          ) : (
            <p className="sud-empty-note">{String(s.guestNoMatch)}</p>
          )}
          {detail.comments.length > 0 && (
            <div className="sud-panel">
              <h3>{String(s.roomComments)}</h3>
              <ul className="sud-comment-list">
                {detail.comments.map((c, i) => (
                  <li key={i} className="sud-comment">
                    <div className="sud-comment-head">
                      <strong>{c.user_name}</strong>
                      <span className="sud-hint">
                        {fmtDate(c.created_at, lang)}
                      </span>
                    </div>
                    <div>{c.body}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>{String(s.room)}</h2>
        {inviteChecked && inviteCode && (
          <div className="sud-panel sud-invite-card">
            <h3>{String(s.guestInviteTitle)}</h3>
            {invite ? (
              <>
                <div className="sud-invite-name">{invite.name}</div>
                <p className="sud-hint">
                  👥 {invite.member_count} {String(s.roomMembersCount)}
                </p>
                {invite.rules && <p className="sud-hint">{invite.rules}</p>}
                <button
                  type="button"
                  className="sud-btn sud-btn-primary"
                  onClick={onLogin}
                >
                  {String(s.guestInviteJoin)}
                </button>
              </>
            ) : (
              <p className="sud-hint">{String(s.guestInviteInvalid)}</p>
            )}
          </div>
        )}
        <div className="sud-guest-teaser">
          <p>{String(s.roomLoginTeaser)}</p>
          <button
            type="button"
            className="sud-btn sud-btn-primary"
            onClick={onLogin}
          >
            {String(s.guestLogin)}
          </button>
        </div>
        {loading ? (
          <p className="sud-empty-note">…</p>
        ) : (
          <>
            <h3>{String(s.roomPublicLobby)}</h3>
            {publicRooms.length === 0 ? (
              <p className="sud-empty-note">{String(s.guestNoRooms)}</p>
            ) : (
              <ul className="sud-board-list">
                {publicRooms.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="sud-room-row-btn"
                      onClick={() => void openDetail(r.id)}
                    >
                      <span className="sud-lb-name">
                        {r.has_active_match && (
                          <span className="sud-live-badge">
                            {String(s.roomLive)}
                          </span>
                        )}{" "}
                        {r.name}
                      </span>
                      <span className="sud-hint">
                        {r.member_count}/{r.max_players}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hotRooms.length > 0 && (
              <>
                <h3>🔥 {String(s.roomHotRooms)}</h3>
                <ul className="sud-board-list">
                  {hotRooms.map((r) => (
                    <li key={r.room_id}>
                      <button
                        type="button"
                        className="sud-room-row-btn"
                        onClick={() => void openDetail(r.room_id)}
                      >
                        <span className="sud-lb-name">{r.name}</span>
                        <span className="sud-hint">
                          {r.matches_7d} · {r.member_count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
