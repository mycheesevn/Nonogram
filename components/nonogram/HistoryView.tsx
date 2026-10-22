"use client";

import { useEffect, useMemo, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import { getPicture } from "@/lib/nonogram/pool";
import { fetchGames, type NoGameRow } from "@/lib/supabase/history";
import {
  fetchMyRoomMatches,
  type MyRoomMatch,
} from "@/lib/supabase/rooms";
import { useAuth } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/client";
import { Pagination, usePagination } from "./Pagination";
import { ReplayView } from "./ReplayView";
import { VideoExportModal, type SudVideoGame } from "./VideoExportModal";
import type { ReplayGame } from "@/lib/nonogram/replay";

const PAGE_SIZE = 10;

interface Props {
  lang: Lang;
  user: { id: string } | null;
  onLogin: () => void;
}

/** Nonogram terminations: 'solved' | 'daily' | 'mistakes' | 'giveup'
 *  (solo rows written by no_record_game_result currently carry a null
 *  reason — the label then falls back to the mode/result). */
function reasonLabel(reason: string | null, s: Record<string, string | string[]>): string {
  switch (reason) {
    case "solved":
      return String(s.sudReasonSolved);
    case "daily":
      return String(s.sudReasonDaily);
    case "mistakes":
      return String(s.sudReasonMistakes);
    case "giveup":
      return String(s.sudReasonGiveup);
    default:
      return reason ?? "";
  }
}

function fmtSecs(total: number): string {
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${`${sec}`.padStart(2, "0")}`;
}

function resultIcon(result: string): string {
  return result === "win" ? "🎉" : result === "loss" ? "😞" : "🤝";
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 260;
  const h = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const stepX = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${(h - 4 - ((p - min) / span) * (h - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="sud-chart" role="img" aria-label="rating progress">
      <path d={d} fill="none" stroke="#db2777" strokeWidth={2} />
    </svg>
  );
}

export function HistoryView({ lang, user, onLogin }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const { cgStats } = useAuth();
  const [games, setGames] = useState<NoGameRow[]>([]);
  const [roomMatches, setRoomMatches] = useState<MyRoomMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<number[]>([]);
  const [replay, setReplay] = useState<ReplayGame | null>(null);
  const [videoGame, setVideoGame] = useState<SudVideoGame | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchGames(user.id, 0, 200)
      .then(({ rows }) => setGames(rows))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetchMyRoomMatches(50)
      .then(setRoomMatches)
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const sb = createClient();
        const { data } = await sb.rpc("no_rating_progress", { p_limit: 60 });
        if (Array.isArray(data)) {
          setRatings((data as { rating: number }[]).map((r) => r.rating));
        }
      } catch { /* sparkline is decorative */ }
    })();
  }, [user, cgStats?.games_played]);

  // Race games also land in no_games (mode 'race', empty log) — they
  // are listed once, in the room-matches section below.
  const soloGames = useMemo(() => games.filter((g) => g.mode !== "race"), [games]);
  const soloPag = usePagination(soloGames, PAGE_SIZE);
  const racePag = usePagination(roomMatches, PAGE_SIZE);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-US");

  const tierNames = (s.sudTierNames as string[] | undefined) ?? [];
  const tierName = (tier: number | null | undefined) =>
    tier ? (tierNames[tier] ?? "") : "";
  const picTitle = (pictureId: string) => {
    const pic = getPicture(pictureId);
    if (!pic) return pictureId || "—";
    return lang === "vi" ? pic.title_vi : pic.title_en;
  };
  const sizeTier = (size: number, tier: number) =>
    `${size}×${size}${tierName(tier) ? ` · ${tierName(tier)}` : ""}`;

  const openReplay = (g: NoGameRow) => {
    const reason = reasonLabel(g.reason, s);
    const subtitleParts = [
      fmtDate(g.created_at),
      sizeTier(g.size, g.tier),
      reason,
      `⏱ ${fmtSecs(g.seconds)}`,
      `❌ ${g.mistakes}`,
    ].filter(Boolean);
    setReplay({
      pictureId: g.picture_id,
      moves: g.moves ?? "",
      size: g.size,
      title: `${resultIcon(g.result)} ${picTitle(g.picture_id)}`,
      subtitle: subtitleParts.join(" · "),
      won: g.result === "win",
      result: g.result,
      perfect: g.perfect,
    });
  };

  if (replay) {
    return (
      <>
        <ReplayView
          lang={lang}
          game={replay}
          onBack={() => setReplay(null)}
          onExportVideo={(g) =>
            setVideoGame({
              pictureId: g.pictureId,
              moves: g.moves,
              won: g.won,
              title: g.title,
              subtitle: g.subtitle,
            })
          }
        />
        <VideoExportModal lang={lang} game={videoGame} onClose={() => setVideoGame(null)} />
      </>
    );
  }

  if (!user) {
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <h2>📜 {String(s.history)}</h2>
          <div className="sud-panel">
            <p className="sud-hint">{String(s.loginToViewHistory)}</p>
            <button type="button" className="sud-btn sud-btn-primary" onClick={onLogin}>
              {String(s.login)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>📜 {String(s.history)}</h2>
        {cgStats && (
          <p className="sud-hint">
            🎉 {cgStats.wins} {String(s.wins)} · 😞 {cgStats.losses} {String(s.losses)} · 🤝{" "}
            {cgStats.draws} {String(s.draws)} · ⭐ {cgStats.rating}
          </p>
        )}
        {ratings.length >= 2 && (
          <div className="sud-panel">
            <strong>📈 {String(s.ratingProgress)}</strong>
            <Sparkline points={ratings} />
          </div>
        )}

        {loading ? (
          <p className="sud-empty-note">…</p>
        ) : soloGames.length === 0 ? (
          <p className="sud-empty-note">{String(s.historyEmpty)}</p>
        ) : (
          <>
            <ul className="sud-board-list">
              {soloPag.pageItems.map((g) => {
                const reason = reasonLabel(g.reason, s);
                const hasMoves = !!(g.moves && g.moves.length > 0);
                return (
                  <li
                    key={g.id}
                    className="sud-lb-row"
                    onClick={hasMoves ? () => openReplay(g) : undefined}
                    style={hasMoves ? { cursor: "pointer" } : undefined}
                  >
                    <span className="sud-lb-name">
                      {resultIcon(g.result)} {picTitle(g.picture_id)}
                      {g.perfect ? " 🏅" : ""}
                      {g.mode === "daily" ? ` · 🌞 ${String(s.sudDaily)}` : ""}
                      {` · ${sizeTier(g.size, g.tier)}`}
                      {reason ? ` · ${reason}` : ""}
                      {` · ⏱ ${fmtSecs(g.seconds)}`}
                      {` · ❌ ${g.mistakes}`}
                      {g.hints_used > 0 ? ` · 💡 ${g.hints_used}` : ""}
                    </span>
                    <span className="sud-lb-title">{fmtDate(g.created_at)}</span>
                    {hasMoves && (
                      <button
                        type="button"
                        className="sud-btn small"
                        onClick={(e) => {
                          e.stopPropagation();
                          openReplay(g);
                        }}
                      >
                        {String(s.replay)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={soloPag.page} pageCount={soloPag.pageCount} onPage={soloPag.setPage} />
          </>
        )}

        <h3>{String(s.roomRoomMatches)}</h3>
        {roomMatches.length === 0 ? (
          <p className="sud-empty-note">{String(s.roomMatchEmpty)}</p>
        ) : (
          <>
            <ul className="sud-board-list">
              {racePag.pageItems.map(({ match, roomName, roomCode, mySeat }) => {
                const myRank =
                  match.results && mySeat >= 0 ? match.results.ranks?.[mySeat] : undefined;
                const myXp =
                  match.results && mySeat >= 0 ? match.results.xp?.[mySeat] : undefined;
                const when = match.finished_at ?? match.created_at;
                return (
                  <li key={match.id} className="sud-lb-row">
                    <span className="sud-lb-name">
                      {myRank === 1 ? "🏆" : "🏁"} {picTitle(match.picture_id)}
                      {` · ${sizeTier(match.size, match.tier)}`}
                      {myRank !== undefined
                        ? ` · ${String(s.rank)} ${myRank}/${match.players.length}`
                        : ""}
                      {myXp ? ` · +${myXp} ${String(s.xp)}` : ""}
                    </span>
                    <span className="sud-lb-title">
                      {roomName}
                      {roomCode ? ` (${roomCode})` : ""}
                      {when ? ` · ${fmtDate(when)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Pagination page={racePag.page} pageCount={racePag.pageCount} onPage={racePag.setPage} />
          </>
        )}
      </div>
    </div>
  );
}
