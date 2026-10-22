"use client";

/** Solo Nonogram: free play (picture pool by size × tier) + the daily
 *  puzzles (one per size per day, identical for everyone). Drag-paint
 *  with axis lock, fill/mark/erase modes, 3-mistake limit with
 *  immediate feedback, solver-backed hints, count-up timer. Winning
 *  reveals the COLOR picture — the share moment. Finished games
 *  record through no_record_game_result (signed-in only; guests play
 *  freely and still feed the site stats events). */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Board, { type FlashCell } from "./Board";
import { SizeTierSelect } from "./LevelSelect";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  NonogramGame,
  MAX_HINTS,
  MAX_MISTAKES,
  type PaintMode,
} from "@/lib/nonogram/flow";
import { nextForcedCell } from "@/lib/nonogram/solver";
import {
  getPicture,
  pictureAt,
  pictureBitmap,
  pictureClues,
  poolCell,
  type NoPicture,
  type PoolSize,
} from "@/lib/nonogram/pool";
import { recordGameResult } from "@/lib/supabase/results";
import { recordGameEvent } from "@/lib/supabase/stats";
import { playCheck, playLose, playMove, playWin } from "@/lib/nonogram/sound";
import { burstConfetti } from "@/lib/nonogram/confetti";
import { sharePictureCard } from "@/lib/nonogram/shareCard";

export interface PlayActions {
  canUndo: boolean;
  canHint: boolean;
  hintThinking: boolean;
  undo: () => void;
  hint: () => void;
  newGame: () => void;
}

interface PlayViewProps {
  lang: Lang;
  user: { id: string } | null;
  onLogin: () => void;
  actionsRef: React.MutableRefObject<PlayActions | null>;
  notifyActions: () => void;
}

const SAVE_KEY = "no-current-v1";
const SIZE_KEY = "no-size";
const TIER_KEY = "no-tier";
const DAILY_DONE_KEY = "no-daily-done";
const RECENT_KEY = "no-recent";

type Kind = "free" | "daily";
type Tier = 1 | 2 | 3;

function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Stable per-day index into a size's 30-picture pool. */
function dailyIndex(size: number, dateKey: string): number {
  let h = 0;
  const str = `no-daily|${dateKey}|${size}`;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 30;
}

function dailyPicture(size: PoolSize, dateKey: string): NoPicture {
  return pictureAt(size, dailyIndex(size, dateKey));
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${`${s}`.padStart(2, "0")}`;
}

interface SavedGame {
  pictureId: string;
  kind: Kind;
  cells: number[][];
  mistakes: number;
  hintsUsed: number;
  seconds: number;
  log: string;
  dateKey: string;
}

export default function PlayView({ lang, user, onLogin, actionsRef, notifyActions }: PlayViewProps) {
  const s = STR[lang] as Record<string, string | string[]>;
  const tierNames = (s.sudTierNames as string[]) ?? [];

  const [size, setSize] = useState<PoolSize>(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY));
      return (v === 5 || v === 10 || v === 15 ? v : 10) as PoolSize;
    } catch {
      return 10;
    }
  });
  const [tier, setTier] = useState<Tier>(() => {
    try {
      const v = Number(localStorage.getItem(TIER_KEY));
      return (v >= 1 && v <= 3 ? v : 2) as Tier;
    } catch {
      return 2;
    }
  });
  const [kind, setKind] = useState<Kind>("free");
  const [picture, setPicture] = useState<NoPicture | null>(null);
  const [mode, setMode] = useState<PaintMode>("fill");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [hintInfo, setHintInfo] = useState<string | null>(null);
  const [xpToast, setXpToast] = useState<number | null>(null);
  const [flash, setFlash] = useState<FlashCell | null>(null);
  const [highlight, setHighlight] = useState<{ r: number; c: number } | null>(null);
  const [, setTick] = useState(0);

  const gameRef = useRef<NonogramGame | null>(null);
  const pictureRef = useRef<NoPicture | null>(null);
  const kindRef = useRef<Kind>("free");
  const recordedRef = useRef(false);
  const priorLogRef = useRef("");
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const modeRef = useRef<PaintMode>("fill");
  modeRef.current = mode;
  const paintRef = useRef<{
    active: boolean;
    startR: number;
    startC: number;
    axis: "row" | "col" | null;
    lastR: number;
    lastC: number;
    madeMistake: boolean;
  } | null>(null);

  const sync = useCallback(() => setTick((t) => t + 1), []);

  const clues = picture ? pictureClues(picture) : { rows: [], cols: [] };
  const game = gameRef.current;
  const ended = !!game && game.status !== "playing";
  const won = !!game && game.status === "won";

  /* ---------- game lifecycle ---------- */

  const pickFreePicture = useCallback((sz: PoolSize, tr: Tier): NoPicture => {
    const cell = poolCell(sz, tr);
    let recent: string[] = [];
    try {
      recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    } catch {
      recent = [];
    }
    const fresh = cell.filter((p) => !recent.includes(p.id));
    const pickFrom = fresh.length > 0 ? fresh : cell;
    const pic = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    try {
      const next = [...recent.filter((id) => id !== pic.id), pic.id].slice(-5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return pic;
  }, []);

  const startGame = useCallback(
    (pic: NoPicture, k: Kind) => {
      const cur = gameRef.current;
      if (cur && cur.status === "playing" && cur.encodeLog().length > 0) {
        recordGameEvent("abandon", { size: pictureRef.current?.size ?? null, tier: pictureRef.current?.grade.tier ?? null });
      }
      const g = new NonogramGame(pictureBitmap(pic), { now: Date.now() });
      gameRef.current = g;
      pictureRef.current = pic;
      kindRef.current = k;
      recordedRef.current = false;
      priorLogRef.current = "";
      paintRef.current = null;
      setPicture(pic);
      setKind(k);
      setSeconds(0);
      setMessage(null);
      setHintInfo(null);
      setXpToast(null);
      setFlash(null);
      setHighlight(null);
      recordGameEvent("start", { size: pic.size, tier: pic.grade.tier });
      sync();
    },
    [sync],
  );

  const startFree = useCallback(
    (sz: PoolSize, tr: Tier) => startGame(pickFreePicture(sz, tr), "free"),
    [pickFreePicture, startGame],
  );

  const startDaily = useCallback(
    (sz: PoolSize) => startGame(dailyPicture(sz, todayKey()), "daily"),
    [startGame],
  );

  /* First mount: restore an in-progress game, else start a free one. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as SavedGame;
        const pic = getPicture(saved.pictureId);
        if (pic && (saved.kind === "free" || saved.dateKey === todayKey())) {
          const g = new NonogramGame(pictureBitmap(pic), { now: Date.now() });
          g.cells = saved.cells.map((row) => row.slice()) as NonogramGame["cells"];
          g.mistakes = saved.mistakes;
          g.hintsUsed = saved.hintsUsed;
          gameRef.current = g;
          pictureRef.current = pic;
          kindRef.current = saved.kind;
          priorLogRef.current = saved.log ?? "";
          recordedRef.current = false;
          setPicture(pic);
          setKind(saved.kind);
          setSize(pic.size as PoolSize);
          setTier(pic.grade.tier as Tier);
          setSeconds(saved.seconds ?? 0);
          sync();
          return;
        }
      }
    } catch {
      /* start fresh */
    }
    startFree(size, tier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Persist the in-progress game. */
  useEffect(() => {
    const g = gameRef.current;
    if (!g || !picture) return;
    try {
      if (g.status === "playing") {
        const saved: SavedGame = {
          pictureId: picture.id,
          kind: kindRef.current,
          cells: g.cells,
          mistakes: g.mistakes,
          hintsUsed: g.hintsUsed,
          seconds,
          log: [priorLogRef.current, g.encodeLog()].filter(Boolean).join(";"),
          dateKey: todayKey(),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      } else {
        localStorage.removeItem(SAVE_KEY);
      }
    } catch {
      /* ignore */
    }
  });

  /* Timer (pauses while the tab is hidden). */
  useEffect(() => {
    if (!game || game.status !== "playing") return;
    const id = setInterval(() => {
      if (!document.hidden) setSeconds((v) => v + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [game?.status, picture]);

  /* ---------- recording ---------- */

  const recordEnd = useCallback(
    (g: NonogramGame, reason: string) => {
      if (recordedRef.current || !pictureRef.current) return;
      recordedRef.current = true;
      const pic = pictureRef.current;
      const result = g.status === "won" ? "win" : "loss";
      recordGameEvent("finish", { result, size: pic.size, tier: pic.grade.tier });
      if (kindRef.current === "daily" && g.status === "won") {
        try {
          const key = `${todayKey()}|${pic.size}`;
          const done = JSON.parse(localStorage.getItem(DAILY_DONE_KEY) ?? "[]") as string[];
          if (!done.includes(key)) {
            done.push(key);
            localStorage.setItem(DAILY_DONE_KEY, JSON.stringify(done));
          }
        } catch {
          /* ignore */
        }
      }
      if (!user) return;
      const moves = [priorLogRef.current, g.encodeLog()].filter(Boolean).join(";");
      void recordGameResult({
        result,
        mode: kindRef.current === "daily" ? "daily" : "solo",
        pictureId: pic.id,
        size: pic.size,
        tier: pic.grade.tier,
        seconds: secondsRef.current,
        mistakes: g.mistakes,
        hintsUsed: g.hintsUsed,
        perfect: g.perfect,
        moves,
      })
        .then((xp) => {
          setXpToast(xp);
          setTimeout(() => setXpToast(null), 5000);
        })
        .catch(() => {
          // Never swallow a failed record silently (family rule):
          // the player must SEE that this game was not counted.
          setMessage(String(s.sudRecordFailed));
        });
    },
    [user, s],
  );

  const checkEnd = useCallback(() => {
    const g = gameRef.current;
    if (!g || recordedRef.current) return;
    if (g.status === "won") {
      playWin();
      burstConfetti();
      recordEnd(g, kindRef.current === "daily" ? "daily" : "solved");
    } else if (g.status === "lost") {
      playLose();
      recordEnd(g, "mistakes");
    }
    sync();
  }, [recordEnd, sync]);

  /* ---------- painting ---------- */

  const applyPaint = useCallback(
    (r: number, c: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "playing") return;
      const ch = g.paint(r, c, modeRef.current);
      setHighlight({ r, c });
      if (ch?.mistake) {
        if (paintRef.current) paintRef.current.madeMistake = true;
        setFlash({ r, c, key: Date.now() });
        playCheck();
        setMessage(String(s.sudWrongDigit));
        setTimeout(() => setMessage(null), 1600);
        setTimeout(() => setFlash(null), 650);
      } else if (ch) {
        playMove();
      }
      sync();
    },
    [s, sync],
  );

  const onPaintStart = useCallback(
    (r: number, c: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "playing") return;
      paintRef.current = { active: true, startR: r, startC: c, axis: null, lastR: r, lastC: c, madeMistake: false };
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
      // Walk from the last painted cell to the target so fast drags
      // never leave gaps.
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
    checkEnd();
  }, [checkEnd]);

  const onQuickMark = useCallback(
    (r: number, c: number) => {
      const g = gameRef.current;
      if (!g || g.status !== "playing") return;
      const prev = modeRef.current;
      modeRef.current = "mark";
      g.beginStroke();
      applyPaint(r, c);
      g.endStroke();
      modeRef.current = prev;
      checkEnd();
    },
    [applyPaint, checkEnd],
  );

  /* ---------- actions ---------- */

  const doUndo = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
    if (g.undo()) {
      setHintInfo(null);
      sync();
    }
  }, [sync]);

  const doHint = useCallback(() => {
    const g = gameRef.current;
    const pic = pictureRef.current;
    if (!g || !pic || g.status !== "playing") return;
    if (g.hintsRemaining <= 0) {
      setMessage(String(s.sudNoHint));
      setTimeout(() => setMessage(null), 2000);
      return;
    }
    const c = pictureClues(pic);
    const forced = nextForcedCell({
      rowClues: c.rows,
      colClues: c.cols,
      size: pic.size,
      known: g.cells.map((row) => row.slice()) as (0 | 1 | 2)[][],
    });
    const reasonNames = (s.noHintReasons as string[]) ?? [];
    if (forced) {
      if (g.useHint(forced.r, forced.c, forced.value)) {
        const reasonIdx = ["overlap", "edge", "complete-count", "cross"].indexOf(forced.reason) + 1;
        setHintInfo(
          String(forced.value === 1 ? s.noHintFillText : s.noHintMarkText).replace(
            "{tech}",
            reasonNames[reasonIdx] ?? forced.reason,
          ),
        );
        setHighlight({ r: forced.r, c: forced.c });
        playMove();
      }
    } else {
      // No line logic forces a cell: reveal one from the solution
      // (and say so honestly, per the design).
      outer: for (let r = 0; r < pic.size; r++) {
        for (let cc = 0; cc < pic.size; cc++) {
          if (g.cells[r][cc] === 0) {
            const value = g.solution[r][cc] ? 1 : 2;
            if (g.useHint(r, cc, value as 1 | 2)) {
              setHintInfo(String(s.noHintRevealText));
              setHighlight({ r, c: cc });
              playMove();
            }
            break outer;
          }
        }
      }
    }
    checkEnd();
  }, [s, checkEnd]);

  const giveUp = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
    g.resign(Date.now());
    playLose();
    recordEnd(g, "giveup");
    sync();
  }, [recordEnd, sync]);

  const changeSize = (sz: PoolSize) => {
    setSize(sz);
    try {
      localStorage.setItem(SIZE_KEY, String(sz));
    } catch {
      /* ignore */
    }
    if (kindRef.current === "daily") startDaily(sz);
    else startFree(sz, tier);
  };

  const changeTier = (tr: Tier) => {
    setTier(tr);
    try {
      localStorage.setItem(TIER_KEY, String(tr));
    } catch {
      /* ignore */
    }
    if (kindRef.current !== "daily") startFree(size, tr);
  };

  /* Header quick actions (AppShell). */
  useEffect(() => {
    actionsRef.current = {
      canUndo: !!game && game.status === "playing" && game.undoDepth > 0,
      canHint: !!game && game.status === "playing" && game.hintsRemaining > 0,
      hintThinking: false,
      undo: doUndo,
      hint: doHint,
      newGame: () => (kindRef.current === "daily" ? startDaily(size) : startFree(size, tier)),
    };
    notifyActions();
  });

  /* Keyboard: arrows move the cursor, F/X/E switch mode, Space paints. */
  const cursorRef = useRef({ r: 0, c: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const g = gameRef.current;
      if (!g || g.status !== "playing" || !pictureRef.current) return;
      const sz = pictureRef.current.size;
      const cur = cursorRef.current;
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const nr = e.key === "ArrowUp" ? Math.max(0, cur.r - 1) : e.key === "ArrowDown" ? Math.min(sz - 1, cur.r + 1) : cur.r;
        const nc = e.key === "ArrowLeft" ? Math.max(0, cur.c - 1) : e.key === "ArrowRight" ? Math.min(sz - 1, cur.c + 1) : cur.c;
        cursorRef.current = { r: nr, c: nc };
        setHighlight({ r: nr, c: nc });
      } else if (e.key === "f" || e.key === "F") setMode("fill");
      else if (e.key === "x" || e.key === "X") setMode("mark");
      else if (e.key === "e" || e.key === "E") setMode("erase");
      else if (e.key === " ") {
        e.preventDefault();
        onPaintStart(cur.r, cur.c);
        onPaintEnd();
      } else if (e.key === "u" || e.key === "U") doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPaintStart, onPaintEnd, doUndo]);

  if (!game || !picture) return null;
  const prog = game.progress();
  const title = lang === "vi" ? picture.title_vi : picture.title_en;
  const dailyDone = (() => {
    try {
      const done = JSON.parse(localStorage.getItem(DAILY_DONE_KEY) ?? "[]") as string[];
      return done.includes(`${todayKey()}|${size}`);
    } catch {
      return false;
    }
  })();

  return (
    <div className="sud-layout">
      <div className="sud-board-col">
        <div className="sud-board-area">
          <div className="sud-board-fit no-board-fit">
            <Board
              size={picture.size}
              rowClues={clues.rows}
              colClues={clues.cols}
              cells={game.cells}
              onPaintStart={onPaintStart}
              onPaintEnter={onPaintEnter}
              onPaintEnd={onPaintEnd}
              onQuickMark={onQuickMark}
              highlight={highlight}
              flash={flash}
              revealed={won ? picture : null}
              disabled={ended}
            />
          </div>
        </div>
      </div>
      <div className="sud-panel">
        <div className="sud-panel-head sud-panel-head-col">
          <div className="sud-level-row">
            <SizeTierSelect
              size={size}
              tier={tier}
              onSize={changeSize}
              onTier={changeTier}
              sizeLabel={String(s.noSizeLabel)}
              tierLabel={String(s.sudTierLabel)}
              tierNames={tierNames}
            />
            <button
              type="button"
              className={`sud-btn${kind === "daily" ? " sud-btn-primary" : ""}`}
              onClick={() => startDaily(size)}
            >
              📅 {String(s.sudDaily)}
            </button>
          </div>
          {kind === "daily" && dailyDone && <p className="sud-hint">{String(s.sudDailyDone)}</p>}
        </div>

        <div className="sud-status">
          <span>
            ⏱ {fmtTime(seconds)} · ❌ {game.mistakes}/{MAX_MISTAKES} · 💡 {game.hintsRemaining}/{MAX_HINTS} ·{" "}
            {String(s.sudProgress)}: {prog.correct}/{prog.total}
          </span>
        </div>

        {hintInfo && <p className="sud-note">{hintInfo}</p>}
        {message && <p className="sud-note">{message}</p>}
        {ended && (
          <div className="sud-status check">
            <strong>{won ? String(s.sudSolved) : String(s.sudFailed)}</strong>
            <span>
              {" "}
              · ⏱ {fmtTime(seconds)}
              {xpToast !== null && ` · +${xpToast} XP`}
            </span>
          </div>
        )}
        {won && (
          <div className="sud-status check">
            <span>
              🖼️ <strong>{title}</strong>
              {game.perfect && ` · ⭐ ${String(s.noPerfect)}`}
            </span>
          </div>
        )}

        <div className="sud-seg no-mode-seg" role="group" aria-label="paint mode">
          <button type="button" className={mode === "fill" ? "active" : ""} disabled={ended} onClick={() => setMode("fill")}>
            ■ {String(s.noModeFill)}
          </button>
          <button type="button" className={mode === "mark" ? "active" : ""} disabled={ended} onClick={() => setMode("mark")}>
            ✕ {String(s.noModeMark)}
          </button>
          <button type="button" className={mode === "erase" ? "active" : ""} disabled={ended} onClick={() => setMode("erase")}>
            ⌫ {String(s.noModeErase)}
          </button>
        </div>

        <div className="sud-panel-btns">
          <button type="button" className="sud-btn" disabled={ended || game.undoDepth === 0} onClick={doUndo}>
            ↩ {String(s.sudUndo)}
          </button>
          <button type="button" className="sud-btn" disabled={ended || game.hintsRemaining <= 0} onClick={doHint}>
            {String(s.sudHintBtn)} ({game.hintsRemaining})
          </button>
          {won && (
            <button
              type="button"
              className="sud-btn"
              onClick={() => {
                void sharePictureCard(picture, { lang, seconds, tierName: tierNames[picture.grade.tier] ?? "" }).catch(() => {});
              }}
            >
              🖼️ {String(s.noSharePic)}
            </button>
          )}
          {!ended ? (
            <button type="button" className="sud-btn" onClick={giveUp}>
              🏳 {String(s.sudGiveUp)}
            </button>
          ) : (
            <button
              type="button"
              className="sud-btn sud-btn-primary"
              onClick={() => (kind === "daily" ? startDaily(size) : startFree(size, tier))}
            >
              {String(s.sudPlayAgain)}
            </button>
          )}
          {!user && (
            <button type="button" className="sud-btn" onClick={onLogin}>
              🔑 {String(s.login)}
            </button>
          )}
        </div>
        <p className="sud-hint">{String(s.noSelectHint)}</p>
      </div>
    </div>
  );
}
