"use client";

/** Nonogram RACE match view. Every seated player paints the SAME pool
 *  picture (the match's picture_id, picked server-side from the seed)
 *  on their own board; each client reports {pct, mistakes, finished}
 *  through no_update_progress and everyone watches the live progress
 *  bars. `finished` means SOLVED — busting out on 3 mistakes reports
 *  the final pct with finished=false and the server ranks accordingly.
 *  The race settles as soon as someone solves or every racer is out —
 *  seated clients then call the idempotent no_finish_room_match,
 *  which DERIVES the ranks server-side. Spectators and guests see the
 *  live % bars; a racer's board (the solved picture) is only shown
 *  once that racer has finished (design §6.3). */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Board, { type FlashCell } from "./Board";
import {
  cancelMatch,
  fetchComments,
  fetchReactions,
  finishRoomMatch,
  getMatchById,
  postComment,
  react,
  REACTIONS,
  startRematch,
  subscribeMatch,
  subscribeReactions,
  unreact,
  updateRaceProgress,
  type FinishResult,
  type MatchReaction,
  type RoomComment,
  type RoomMatch,
} from "@/lib/supabase/rooms";
import {
  allDone,
  anyoneSolved,
  emptyProgress,
  finalRanks,
  mySeatInMatch,
  normProgress,
  racePicture,
  raceStandings,
  SEAT_COLORS,
  SEAT_EMOJI,
  type RaceProgress,
} from "@/lib/supabase/matchUtil";
import {
  NonogramGame,
  type PaintMode,
} from "@/lib/nonogram/flow";
import { pictureBitmap, pictureClues } from "@/lib/nonogram/pool";
import { RoomChat } from "./RoomChat";
import { RoomVoice } from "./RoomVoice";
import { createClient } from "@/lib/supabase/client";
import { playCheck, playLose, playMove, playWin } from "@/lib/nonogram/sound";
import { burstConfetti } from "@/lib/nonogram/confetti";
import { STR, type Lang } from "@/lib/nonogram/i18n";

interface Props {
  match: RoomMatch;
  roomId: string;
  lang: Lang;
  userId: string | null;
  guest: boolean;
  /** Signed-in ROOM MEMBER (player or spectator). Room chat and
   *  listener-mode voice are member-only per the family patterns;
   *  non-member signed-in viewers (join card pending) see neither. */
  member: boolean;
  names: Record<string, string>;
  onExit: () => void;
  onMatchChange: (m: RoomMatch) => void;
  onRequireLogin?: () => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${`${s}`.padStart(2, "0")}`;
}

const EMPTY_CELLS = (size: number) =>
  Array.from({ length: size }, () => new Array(size).fill(0));

export default function RoomMatchView({
  match: initialMatch,
  roomId,
  lang,
  userId,
  guest,
  member,
  names,
  onExit,
  onMatchChange,
  onRequireLogin,
}: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const tierNames = (s.sudTierNames as string[]) ?? [];

  const [liveMatch, setLiveMatch] = useState<RoomMatch>(initialMatch);
  const liveRef = useRef(liveMatch);
  liveRef.current = liveMatch;

  const mySeat = mySeatInMatch(userId, liveMatch.players);
  const seated = mySeat >= 0 && !guest;
  const picture = racePicture(liveMatch);
  const active = liveMatch.status === "active";
  const finished = liveMatch.status === "finished";

  /* ---- my local race game ---- */
  const gameRef = useRef<NonogramGame | null>(null);
  const [mode, setMode] = useState<PaintMode>("fill");
  const modeRef = useRef<PaintMode>("fill");
  modeRef.current = mode;
  const [seconds, setSeconds] = useState(0);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const [flash, setFlash] = useState<FlashCell | null>(null);
  const [highlight, setHighlight] = useState<{ r: number; c: number } | null>(null);
  const [, setTick] = useState(0);
  const sync = useCallback(() => setTick((t) => t + 1), []);
  const myDoneRef = useRef(false);
  const [myOut, setMyOut] = useState(false);
  const [myXp, setMyXp] = useState<FinishResult | null>(null);
  const settleTriedRef = useRef(false);
  const celebratedRef = useRef(false);
  const paintRef = useRef<{
    active: boolean;
    startR: number;
    startC: number;
    axis: "row" | "col" | null;
    lastR: number;
    lastC: number;
  } | null>(null);

  /* ---- spectator board ---- */
  const [watchSeat, setWatchSeat] = useState(0);

  /* ---- comments + reactions ---- */
  const [comments, setComments] = useState<RoomComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [reactions, setReactions] = useState<MatchReaction[]>([]);
  const [floaters, setFloaters] = useState<{ id: number; emoji: string }[]>([]);

  const applyMatch = useCallback(
    (m: RoomMatch) => {
      setLiveMatch(m);
      onMatchChange(m);
    },
    [onMatchChange],
  );

  /* Live match updates: realtime subscription + a polling fallback. */
  useEffect(() => {
    if (guest) return;
    const ch = subscribeMatch(liveMatch.id, (m) => applyMatch(m));
    const timer = setInterval(() => {
      getMatchById(liveMatch.id)
        .then((m) => {
          if (m) applyMatch(m);
        })
        .catch(() => {});
    }, 4000);
    return () => {
      clearInterval(timer);
      try {
        createClient().removeChannel(ch);
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMatch.id, guest]);

  /* Guest parents re-fetch the detail RPC and hand us a fresh match
   * object — adopt its progress/status wholesale. */
  useEffect(() => {
    if (initialMatch.id === liveRef.current.id) {
      setLiveMatch(initialMatch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMatch]);

  /* Start my local game when the race is active and I'm seated. */
  useEffect(() => {
    if (!seated || !active || !picture || gameRef.current) return;
    gameRef.current = new NonogramGame(pictureBitmap(picture), { now: Date.now() });
    // Report the initial (empty) progress row so others see me racing.
    void updateRaceProgress(liveMatch.id, 0, 0, false).catch(() => {});
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seated, active, picture]);

  /* My race clock (stops when I'm out). */
  useEffect(() => {
    if (!seated || !active || myOut) return;
    const id = setInterval(() => {
      if (!document.hidden) setSeconds((v) => v + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [seated, active, myOut]);

  const reportProgress = useCallback(
    (force = false) => {
      const g = gameRef.current;
      if (!g || !userId) return;
      if (myDoneRef.current && !force) return;
      const solved = g.status === "won";
      const out = g.status !== "playing";
      if (out) myDoneRef.current = true;
      const pct = Math.round(g.progress().pct);
      void updateRaceProgress(liveMatch.id, pct, g.mistakes, solved).catch(() => {});
      // Optimistically merge my row locally so standings feel instant.
      const row: RaceProgress = {
        pct,
        mistakes: g.mistakes,
        secs: secondsRef.current,
        finished: solved,
        finished_at: solved ? new Date().toISOString() : null,
      };
      setLiveMatch((prev) => ({
        ...prev,
        progress: { ...(prev.progress ?? {}), [userId]: row },
      }));
    },
    [liveMatch.id, userId],
  );

  /* Periodic progress sync (timer drift). */
  useEffect(() => {
    if (!seated || !active) return;
    const id = setInterval(() => reportProgress(), 3000);
    return () => clearInterval(id);
  }, [seated, active, reportProgress]);

  /* Settlement: someone solved or everyone is out → every seated
   * client calls the idempotent finish RPC; the server derives the
   * ranks from the stored progress rows. */
  useEffect(() => {
    if (!seated || guest) return;
    const m = liveMatch;
    if (m.status === "finished") {
      if (!settleTriedRef.current) {
        settleTriedRef.current = true;
        finishRoomMatch(m.id)
          .then((xp) => {
            if (xp && !xp.already_finished) setMyXp(xp);
          })
          .catch(() => {});
      }
      return;
    }
    if (m.status !== "active") return;
    if (anyoneSolved(m) || allDone(m)) {
      finishRoomMatch(m.id)
        .then((xp) => {
          if (xp) setMyXp(xp);
          return getMatchById(m.id);
        })
        .then((fresh) => {
          if (fresh) applyMatch(fresh);
        })
        .catch(() => {});
    }
  }, [liveMatch, seated, guest, applyMatch]);

  /* Confetti when I take rank 1. */
  useEffect(() => {
    if (!finished || !userId || celebratedRef.current) return;
    const ranks = finalRanks(liveMatch);
    const myRank = ranks && mySeat >= 0 ? ranks[mySeat] : null;
    if (myRank === 1) {
      celebratedRef.current = true;
      playWin();
      burstConfetti();
    }
  }, [finished, liveMatch, userId, mySeat]);

  /* Comments + reactions. */
  useEffect(() => {
    if (guest) return;
    fetchComments(roomId)
      .then(setComments)
      .catch(() => {});
    fetchReactions(liveMatch.id)
      .then(setReactions)
      .catch(() => {});
    const ch = subscribeReactions(liveMatch.id, (emoji) => {
      fetchReactions(liveMatch.id)
        .then(setReactions)
        .catch(() => {});
      const id = Date.now() + Math.random();
      setFloaters((f) => [...f.slice(-5), { id, emoji }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2600);
    });
    return () => {
      try {
        createClient().removeChannel(ch);
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, liveMatch.id, guest]);

  /* ---- painting (same drag/axis-lock discipline as solo play) ---- */
  const applyPaint = useCallback(
    (r: number, c: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "playing") return;
      const ch = g.paint(r, c, modeRef.current);
      setHighlight({ r, c });
      if (ch?.mistake) {
        setFlash({ r, c, key: Date.now() });
        playCheck();
        setTimeout(() => setFlash(null), 650);
        if ((g.status as string) === "lost") {
          playLose();
          setMyOut(true);
        }
      } else if (ch) {
        playMove();
      }
      sync();
    },
    [sync],
  );

  const onPaintStart = useCallback(
    (r: number, c: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "playing") return;
      paintRef.current = { active: true, startR: r, startC: c, axis: null, lastR: r, lastC: c };
      g.beginStroke();
      applyPaint(r, c);
    },
    [applyPaint],
  );

  const onPaintEnter = useCallback(
    (r: number, c: number) => {
      const p = paintRef.current;
      const g = gameRef.current;
      if (!p?.active || !g || g.status !== "playing") return;
      if (p.axis === null && (r !== p.startR || c !== p.startC)) {
        p.axis = Math.abs(r - p.startR) >= Math.abs(c - p.startC) ? "col" : "row";
      }
      const tr = p.axis === "row" ? p.startR : r;
      const tc = p.axis === "col" ? p.startC : c;
      let cr = p.lastR;
      let cc = p.lastC;
      const stepR = Math.sign(tr - cr);
      const stepC = Math.sign(tc - cc);
      while (cr !== tr || cc !== tc) {
        if (cr !== tr) cr += stepR;
        else if (cc !== tc) cc += stepC;
        applyPaint(cr, cc);
      }
      p.lastR = tr;
      p.lastC = tc;
    },
    [applyPaint],
  );

  const onPaintEnd = useCallback(() => {
    const g = gameRef.current;
    if (paintRef.current) paintRef.current.active = false;
    paintRef.current = null;
    g?.endStroke();
    if (g?.status === "won") {
      playWin();
      setMyOut(true);
    }
    reportProgress(g?.status !== "playing");
  }, [reportProgress]);

  const giveUpRace = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
    g.resign(Date.now());
    playLose();
    setMyOut(true);
    reportProgress(true);
    sync();
  }, [reportProgress, sync]);

  const sendComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    setCommentText("");
    try {
      await postComment(roomId, liveMatch.id, body, 0);
      const fresh = await fetchComments(roomId);
      setComments(fresh);
    } catch {
      /* ignore */
    }
  };

  const toggleReaction = async (emoji: string) => {
    if (!userId) {
      onRequireLogin?.();
      return;
    }
    const mine = reactions.some((r) => r.user_id === userId && r.emoji === emoji);
    try {
      if (mine) {
        await unreact(liveMatch.id, emoji);
        setReactions((prev) =>
          prev.filter((r) => !(r.user_id === userId && r.emoji === emoji)),
        );
      } else {
        await react(liveMatch.id, emoji);
      }
    } catch {
      /* ignore */
    }
  };

  if (!picture) return null;
  const clues = pictureClues(picture);
  const game = gameRef.current;
  const standings = raceStandings(liveMatch);
  const ranks = finalRanks(liveMatch);
  const myProgress: RaceProgress =
    (userId && liveMatch.progress?.[userId]
      ? normProgress(liveMatch.progress[userId])
      : null) ?? emptyProgress();
  const watched = standings[watchSeat] ?? standings[0];
  const watchedSolved = watched
    ? normProgress(liveMatch.progress?.[watched.userId]).finished
    : false;
  const picTitle = lang === "vi" ? picture.title_vi : picture.title_en;

  return (
    <div className="sud-layout">
      <div className="sud-board-col">
        <div className="sud-board-area">
          <div className="sud-board-fit no-board-fit">
            {seated && game ? (
              <Board
                size={picture.size}
                rowClues={clues.rows}
                colClues={clues.cols}
                cells={game.cells}
                onPaintStart={onPaintStart}
                onPaintEnter={onPaintEnter}
                onPaintEnd={onPaintEnd}
                highlight={highlight}
                flash={flash}
                revealed={game.status === "won" ? picture : null}
                disabled={!active || game.status !== "playing"}
              />
            ) : watchedSolved || finished ? (
              <Board
                size={picture.size}
                rowClues={clues.rows}
                colClues={clues.cols}
                cells={EMPTY_CELLS(picture.size)}
                revealed={picture}
                disabled
              />
            ) : (
              <Board
                size={picture.size}
                rowClues={clues.rows}
                colClues={clues.cols}
                cells={EMPTY_CELLS(picture.size)}
                disabled
              />
            )}
            {floaters.map((f) => (
              <span key={f.id} className="sud-floater">
                {f.emoji}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="sud-panel">
        <div className="sud-panel-head">
          <button type="button" onClick={onExit}>
            ← {String(s.roomBackToRoom)}
          </button>
          <strong>
            🏁 {String(s.sudRaceTitle)} · {liveMatch.size}×{liveMatch.size} ·{" "}
            {tierNames[liveMatch.tier] ?? ""}
            {finished && ` · 🖼️ ${picTitle}`}
          </strong>
        </div>

        {/* Live comms first (family aside order): voice + private
            room chat ON TOP, the race standings below, public race
            comments last. Racers join the voice mesh; signed-in
            members not in the race listen receive-only. */}
        {!guest && member && userId && (
          <RoomVoice
            lang={lang}
            roomId={roomId}
            myUserId={userId}
            peerUserIds={
              seated ? liveMatch.players.filter((p) => p !== userId) : []
            }
            mode={seated ? "player" : "listener"}
          />
        )}
        {!guest && member && userId && (
          <RoomChat roomId={roomId} lang={lang} />
        )}

        {active && !seated && (
          <p className="sud-hint">{String(s.sudRaceWaiting)}</p>
        )}

        {/* standings / progress bars */}
        <div className="sud-ranks">
          {standings.map((st, idx) => {
            const rank = ranks ? ranks[st.seat] : idx + 1;
            const isMe = st.userId === userId;
            return (
              <div key={st.userId} className="sud-rank-row">
                <span>{finished ? ["🥇", "🥈", "🥉", "4️⃣"][rank - 1] ?? "" : SEAT_EMOJI[st.seat]}</span>
                <span className="sud-dot" style={{ background: SEAT_COLORS[st.seat] }} />
                <span className="sud-rank-name">
                  {names[st.userId] ?? "…"}
                  {isMe ? " (you)" : ""}
                </span>
                <span className="sud-progress">
                  <span className="sud-progress-fill" style={{ width: `${st.progress.pct}%` }} />
                </span>
                <span className="sud-hint">
                  {st.progress.pct}% · ❌{st.progress.mistakes} · ⏱{fmtTime(st.progress.secs)}
                  {st.progress.finished
                    ? ` · 🏁 ${String(s.sudRaceDone)}`
                    : st.progress.mistakes >= 3
                      ? " · 🏳"
                      : ""}
                </span>
                {!seated || finished ? (
                  <button
                    type="button"
                    className="sud-btn small"
                    onClick={() => setWatchSeat(idx)}
                  >
                    👁
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {seated && active && game && (
          <>
            <div className="sud-status">
              <span>
                ⏱ {fmtTime(seconds)} · ❌ {game.mistakes}/3 · {String(s.sudProgress)}:{" "}
                {Math.round(game.progress().pct)}%
              </span>
            </div>
            <div className="sud-seg no-mode-seg" role="group" aria-label="paint mode">
              <button type="button" className={mode === "fill" ? "active" : ""} disabled={game.status !== "playing"} onClick={() => setMode("fill")}>
                ■ {String(s.noModeFill)}
              </button>
              <button type="button" className={mode === "mark" ? "active" : ""} disabled={game.status !== "playing"} onClick={() => setMode("mark")}>
                ✕ {String(s.noModeMark)}
              </button>
              <button type="button" className={mode === "erase" ? "active" : ""} disabled={game.status !== "playing"} onClick={() => setMode("erase")}>
                ⌫ {String(s.noModeErase)}
              </button>
            </div>
            <div className="sud-panel-btns">
              <button
                type="button"
                className="sud-btn"
                disabled={game.status !== "playing" || game.undoDepth === 0}
                onClick={() => {
                  if (game.undo()) {
                    reportProgress();
                    sync();
                  }
                }}
              >
                ↩ {String(s.sudUndo)}
              </button>
              <button type="button" className="sud-btn" disabled={game.status !== "playing"} onClick={giveUpRace}>
                🏳 {String(s.sudGiveUp)}
              </button>
              <button
                type="button"
                className="sud-btn"
                onClick={() => {
                  if (window.confirm(String(s.cancelMatch))) {
                    void cancelMatch(liveMatch.id).catch(() => {});
                  }
                }}
              >
                {String(s.cancelMatch)}
              </button>
            </div>
          </>
        )}

        {finished && (
          <div className="sud-status check">
            <strong>
              {standings[0] && ranks && ranks[standings[0].seat] === 1 && standings.filter((st) => ranks[st.seat] === 1).length === 1
                ? standings[0].userId === userId
                  ? String(s.sudRaceYouWon)
                  : `🏆 ${names[standings[0].userId] ?? ""}`
                : `🤝 ${names[standings[0]?.userId ?? ""] ?? ""}`}
            </strong>
            {myXp && (
              <span>
                {" "}
                · +{myXp.play_xp + myXp.host_xp + myXp.daily_xp} XP
              </span>
            )}
          </div>
        )}

        <div className="sud-panel-btns">
          {finished && seated && (
            <button
              type="button"
              className="sud-btn sud-btn-primary"
              onClick={() => {
                startRematch(roomId)
                  .then((m) => applyMatch(m))
                  .catch(() => {});
              }}
            >
              🔁 {String(s.rematch)}
            </button>
          )}
          {guest && (
            <button type="button" className="sud-btn sud-btn-primary" onClick={onRequireLogin}>
              🔑 {String(s.login)}
            </button>
          )}
        </div>

        {/* reactions */}
        {finished && (
          <div className="sud-reactions">
            {REACTIONS.map((emoji) => {
              const count = reactions.filter((r) => r.emoji === emoji).length;
              const mine = reactions.some(
                (r) => r.user_id === userId && r.emoji === emoji,
              );
              return (
                <button
                  key={emoji}
                  type="button"
                  className={mine ? "sud-reaction mine" : "sud-reaction"}
                  onClick={() => void toggleReaction(emoji)}
                >
                  {emoji} {count > 0 ? count : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* comments */}
        {!guest && (
          <div className="sud-comments">
            <div className="sud-comment-form">
              <input
                className="sud-input"
                value={commentText}
                maxLength={500}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendComment();
                }}
                placeholder={String(s.commentPlaceholder)}
              />
              <button type="button" className="sud-btn small" onClick={() => void sendComment()}>
                {String(s.send)}
              </button>
            </div>
            <ul className="sud-comment-list">
              {comments
                .filter((c) => !c.match_id || c.match_id === liveMatch.id)
                .slice(0, 20)
                .map((c) => (
                  <li key={c.id} className="sud-comment">
                    <div className="sud-comment-head">
                      <strong>{names[c.user_id] ?? "…"}</strong>
                      <span className="sud-hint">
                        {new Date(c.created_at).toLocaleTimeString(
                          lang === "vi" ? "vi-VN" : "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                    <div>{c.body}</div>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {myOut && !myProgress.finished && active && (
          <p className="sud-hint">🏳 {String(s.sudRaceWaiting)}</p>
        )}
      </div>
    </div>
  );
}
