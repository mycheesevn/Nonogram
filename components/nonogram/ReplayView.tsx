"use client";

/** Step / auto-play viewer for a recorded Nonogram solve: the board
 *  fills in entry by entry (mistakes flash red), and at the final
 *  step the finished picture is revealed in COLOR — the win moment.
 *  A won game also gets the family confetti burst at the end. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Board from "./Board";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  buildReplay,
  frameAtStep,
  type ReplayGame,
  type ReplayStep,
} from "@/lib/nonogram/replay";
import { pictureClues } from "@/lib/nonogram/pool";
import { burstConfetti } from "@/lib/nonogram/confetti";

interface Props {
  lang: Lang;
  game: ReplayGame;
  onBack: () => void;
  onExportVideo?: (g: ReplayGame) => void;
}

const SPEEDS = [0.5, 1, 2] as const;
const BASE_MS = 550;

function stepIcon(step: ReplayStep): string {
  switch (step.kind) {
    case "mistake":
      return "❌";
    case "fill":
      return "⬛";
    case "mark":
      return "✕";
    case "erase":
      return "⌫";
    case "hint":
      return "💡";
    case "undo":
      return "↩";
  }
}

export function ReplayView({ lang, game, onBack, onExportVideo }: Props) {
  const s = STR[lang] as unknown as Record<string, string | string[]>;
  const replay = useMemo(
    () =>
      buildReplay({
        pictureId: game.pictureId,
        moves: game.moves,
        size: game.size,
      }),
    [game],
  );
  const total = replay?.totalSteps ?? 0;
  const clues = useMemo(
    () => (replay ? pictureClues(replay.picture) : { rows: [], cols: [] }),
    [replay],
  );
  const [step, setStep] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setStep(0);
    setAutoplay(false);
  }, [game]);

  useEffect(() => {
    if (!autoplay) return;
    if (step >= total) {
      setAutoplay(false);
      return;
    }
    timer.current = window.setTimeout(
      () => setStep((p) => Math.min(total, p + 1)),
      BASE_MS / speed,
    );
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [autoplay, step, total, speed]);

  const atEnd = total > 0 && step >= total;
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (atEnd && game.won && !celebratedRef.current) {
      celebratedRef.current = true;
      const t = window.setTimeout(() => burstConfetti(), 350);
      return () => window.clearTimeout(t);
    }
    if (!atEnd) celebratedRef.current = false;
  }, [atEnd, game.won]);

  if (!replay) {
    return (
      <div className="sud-layout">
        <div className="sud-panel">
          <div className="sud-panel-head">
            <strong>🎞️ {game.title}</strong>
            <button type="button" className="sud-btn small" onClick={onBack}>
              ← {String(s.history)}
            </button>
          </div>
          <p className="sud-hint">{game.subtitle}</p>
          <p className="sud-empty-note">{String(s.historyEmpty)}</p>
        </div>
      </div>
    );
  }

  const cells = frameAtStep(replay, step);
  const current: ReplayStep | null = step > 0 ? replay.steps[step - 1] : null;
  const resultLine = game.won
    ? `🎉 ${String(s.sudSolved)}`
    : game.result === "draw"
      ? `🤝 ${String(s.replayStalemate)}`
      : `😞 ${String(s.sudFailed)}`;

  return (
    <div className="sud-layout">
      <div className="sud-board-col">
        <div className="sud-board-area">
          <div className="sud-board-fit">
            <Board
              size={replay.picture.size}
              rowClues={clues.rows}
              colClues={clues.cols}
              cells={cells}
              revealed={atEnd ? replay.picture : null}
              highlight={
                current && current.r !== null && current.c !== null && !atEnd
                  ? { r: current.r, c: current.c }
                  : null
              }
              disabled
            />
          </div>
        </div>
      </div>
      <div className="sud-panel">
        <div className="sud-panel-head">
          <strong>🎞️ {game.title}</strong>
          <button type="button" className="sud-btn small" onClick={onBack}>
            ← {String(s.history)}
          </button>
        </div>
        <p className="sud-hint">{game.subtitle}</p>

        <div className="sud-replay-controls">
          <button type="button" onClick={() => setStep(0)} disabled={step === 0}>⏮</button>
          <button type="button" onClick={() => setStep((p) => Math.max(0, p - 1))} disabled={step === 0}>◀</button>
          <button
            type="button"
            onClick={() => {
              if (step >= total) setStep(0);
              setAutoplay((a) => !a);
            }}
          >
            {autoplay ? String(s.replayPause) : String(s.replayAuto)}
          </button>
          <button type="button" onClick={() => setStep((p) => Math.min(total, p + 1))} disabled={step >= total}>▶|</button>
          <button type="button" onClick={() => setStep(total)} disabled={step >= total}>⏭</button>
          <span>
            {step}/{total}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={step}
          onChange={(e) => {
            setAutoplay(false);
            setStep(Number(e.target.value));
          }}
          className="sud-replay-slider"
          aria-label={String(s.replayProgress)}
        />

        <div className="sud-video-row">
          <span className="sud-video-label">{String(s.replaySpeed)}</span>
          <div className="sud-seg" role="group" aria-label={String(s.replaySpeed)}>
            {SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                className={speed === v ? "active" : ""}
                onClick={() => setSpeed(v)}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>

        {current && (
          <div className="sud-turn-line">
            {stepIcon(current)}{" "}
            {current.r !== null && current.c !== null
              ? `${lang === "vi" ? "Hàng" : "Row"} ${current.r + 1} · ${
                  lang === "vi" ? "Cột" : "Col"
                } ${current.c + 1}`
              : current.raw}
            {current.mistake ? " ❌" : ""}
          </div>
        )}

        {atEnd && (
          <div className="sud-turn-line">
            {resultLine}
            {game.perfect ? " 🏅" : ""}
          </div>
        )}

        {onExportVideo && (
          <div className="sud-panel-btns">
            <button type="button" className="sud-btn" onClick={() => onExportVideo(game)}>
              🎬 {String(s.exportVideo)}
            </button>
          </div>
        )}

        <strong>{String(s.replayMoves)}</strong>
        <div className="sud-log">
          {replay.steps.map((p) => (
            <button
              key={p.index}
              type="button"
              className={p.index === step ? "sud-log-row sud-log-on" : "sud-log-row"}
              onClick={() => {
                setAutoplay(false);
                setStep(p.index);
              }}
            >
              {p.index}. {stepIcon(p)}{" "}
              {p.r !== null && p.c !== null ? `R${p.r + 1}C${p.c + 1}` : p.raw}
              {p.kind === "hint" ? " 💡" : ""}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ReplayView;
