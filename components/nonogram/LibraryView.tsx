"use client";

/** Bí Kíp — Nonogram technique lessons. Each drill is a real,
 *  machine-verified position from the picture pool
 *  (lib/nonogram/lessons.ts + scripts/verify-lessons.ts): the
 *  target cell is genuinely forced by the lesson's technique.
 *  The learner paints the target with the right mode (fill / mark);
 *  progress syncs via the shared library_progress table (no- ids),
 *  with a localStorage fallback for guests. */
import React, { useEffect, useMemo, useState } from "react";
import Board from "./Board";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  LESSONS,
  drillCells,
  drillClues,
  drillPicture,
  type NoLesson,
} from "@/lib/nonogram/lessons";
import type { CellState, PaintMode } from "@/lib/nonogram/flow";
import {
  completeLesson,
  loadLocalDone,
  syncLibraryProgress,
} from "@/lib/supabase/libraryProgress";
import { playCheck, playMove, playWin } from "@/lib/nonogram/sound";

interface LibraryViewProps {
  lang: Lang;
  userId: string | null;
}

export default function LibraryView({ lang, userId }: LibraryViewProps) {
  const s = STR[lang] as Record<string, string | string[]>;
  // Lesson content ships vi/en only (lib/nonogram/lessons.ts): VI for
  // Vietnamese, EN for every other locale (the family fallback).
  const bl = lang === "vi" ? "vi" : "en";

  const [done, setDone] = useState<string[]>(() => loadLocalDone());
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [cells, setCells] = useState<CellState[][] | null>(null);
  const [mode, setMode] = useState<PaintMode>("fill");
  const [msg, setMsg] = useState<string | null>(null);
  const [justDone, setJustDone] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let dead = false;
    syncLibraryProgress()
      .then((ids) => {
        if (!dead) setDone(ids);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [userId]);

  const lesson: NoLesson | null = activeIdx !== null ? LESSONS[activeIdx] : null;
  const size = lesson ? drillPicture(lesson).size : 0;
  const clues = useMemo(() => (lesson ? drillClues(lesson) : null), [lesson]);

  const openLesson = (idx: number) => {
    const l = LESSONS[idx];
    setActiveIdx(idx);
    setCells(drillCells(l));
    setMode(l.drill.action);
    setMsg(null);
    setJustDone(false);
  };

  const finishLesson = async () => {
    if (!lesson) return;
    setJustDone(true);
    playWin();
    const ids = await completeLesson(lesson.id).catch(() => null);
    if (ids) setDone(ids);
    else setDone((d) => (d.includes(lesson.id) ? d : [...d, lesson.id]));
  };

  /** Simple drill painting: only the target cell responds, with the
   *  currently selected mode. Right mode solves the drill; wrong
   *  mode (or painting anywhere else is ignored) asks for a retry. */
  const paint = (r: number, c: number) => {
    if (!lesson || !cells || justDone) return;
    const t = lesson.drill.target;
    if (r !== t.r || c !== t.c) return;
    if (mode !== lesson.drill.action) {
      playCheck();
      setMsg(String(s.bikipQuizWrong));
      return;
    }
    const next = cells.map((row) => row.slice());
    next[r][c] = lesson.drill.action === "fill" ? 1 : 2;
    setCells(next);
    playMove();
    setMsg(null);
    void finishLesson();
  };

  if (lesson && cells && clues) {
    const t = lesson.drill.target;
    return (
      <div className="sud-layout">
        <div className="sud-board-col">
          <div className="sud-board-area">
            <div className="sud-board-fit">
              <Board
                size={size}
                rowClues={clues.rows}
                colClues={clues.cols}
                cells={cells}
                onPaintStart={paint}
                target={t.r * size + t.c}
                disabled={justDone}
              />
            </div>
          </div>
        </div>
        <div className="sud-panel">
          <div className="sud-panel-head">
            <button type="button" className="sud-btn" onClick={() => setActiveIdx(null)}>
              {String(s.bikipBack)}
            </button>
            <strong>
              {lesson.icon} {lesson.title[bl]}
            </strong>
          </div>
          {lesson.body[bl].split("\n\n").map((para, i) => (
            <p key={i} className="sud-note">
              {para}
            </p>
          ))}
          <p className="sud-hint">{lesson.prompt[bl]}</p>
          <div className="sud-seg no-mode-seg" role="group" aria-label="paint mode">
            <button
              type="button"
              className={mode === "fill" ? "active" : ""}
              disabled={justDone}
              onClick={() => setMode("fill")}
            >
              ■ {String(s.noModeFill)}
            </button>
            <button
              type="button"
              className={mode === "mark" ? "active" : ""}
              disabled={justDone}
              onClick={() => setMode("mark")}
            >
              ✕ {String(s.noModeMark)}
            </button>
          </div>
          {msg && <p className="sud-note">{msg}</p>}
          {justDone && (
            <>
              <div className="sud-status check">
                <strong>
                  {String(s.bikipQuizCorrect)} {String(s.bikipComplete)}
                </strong>
              </div>
              <p className="sud-note">{lesson.explain[bl]}</p>
              {activeIdx !== null && activeIdx + 1 < LESSONS.length && (
                <div className="sud-panel-btns">
                  <button
                    type="button"
                    className="sud-btn sud-btn-primary"
                    onClick={() => openLesson(activeIdx + 1)}
                  >
                    {String(s.bikipNext)}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>{String(s.bikip)}</h2>
        <p className="sud-hint">{String(s.bikipSubtitle)}</p>
        <p className="sud-hint">
          {done.filter((id) => id.startsWith("no-")).length}/{LESSONS.length}{" "}
          {String(s.lessonsDone)}
        </p>
        <div className="sud-panel">
          {LESSONS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              className="sud-btn sud-lesson-row"
              onClick={() => openLesson(i)}
            >
              <span>
                {done.includes(l.id) ? "✅" : "⬜"} {l.icon} {l.title[bl]}
              </span>
              <span>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
