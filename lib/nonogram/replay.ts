/**
 * replay.ts — Nonogram solve replay: parse a recorded move log into
 * board frames (design §5 log format, see flow.ts `encodeLog`).
 *
 * Log entries (semicolon-joined, one per cell change):
 *   f<r>,<c>      fill            x<r>,<c>      mark (✕ note)
 *   e<r>,<c>      back to unknown (toggle-off / erase)
 *   !<r>,<c>      wrong fill — a mistake; the cell ends UNKNOWN
 *   h<r>,<c>=f|x  hint reveal (f = fill, x = mark)
 *   u             undo of the previous stroke
 *
 * Undo rule (pragmatic family rule): strokes are NOT delimited in the
 * log, so each entry is its own unit. While applying entries we keep
 * a history stack of (r, c, prevState) — the state the cell had BEFORE
 * that entry. A `u` entry pops the most recent stacked change and
 * restores that cell to its recorded prevState. That is exact for
 * single-cell strokes and acceptable for drags (it reverts the last
 * cell of the drag rather than the whole drag).
 */
import type { CellState } from "./flow";
import { getPicture, type NoPicture } from "./pool";

export type { NoPicture };

/** Anything carrying a picture id + a move log: a NoGameRow from
 *  lib/supabase/history.ts, or the loose {pictureId, moves, size}
 *  shape used by the video exporter. */
export interface ReplaySource {
  picture_id?: string;
  pictureId?: string;
  moves: string;
  size?: number;
}

export type ReplayStepKind =
  | "fill"
  | "mark"
  | "erase"
  | "mistake"
  | "hint"
  | "undo";

export interface ReplayStep {
  /** 1-based step number; frame `index` is the board AFTER this step. */
  index: number;
  /** The raw log entry, e.g. "f3,4" or "u". */
  raw: string;
  kind: ReplayStepKind;
  /** Cell touched (null for an undo with nothing left to revert). */
  r: number | null;
  c: number | null;
  /** True for wrong-fill entries (`!…`). */
  mistake: boolean;
  /** Cell state after this step (null when r/c are null). */
  after: CellState | null;
}

export interface NonogramReplay {
  picture: NoPicture;
  /** frames[0] = empty board; frames[i] = board after step i. */
  frames: CellState[][][];
  steps: ReplayStep[];
  /** 1-based step indices that were wrong fills. */
  mistakeSteps: Set<number>;
  totalSteps: number;
}

function emptyBoard(size: number): CellState[][] {
  return Array.from({ length: size }, () =>
    new Array<CellState>(size).fill(0),
  );
}

function cloneBoard(b: CellState[][]): CellState[][] {
  return b.map((row) => row.slice()) as CellState[][];
}

const CELL_ENTRY = /^([fxe!])(\d+),(\d+)$/;
const HINT_ENTRY = /^h(\d+),(\d+)=([fx])$/;

/**
 * Build the replay for a recorded game. Returns null when the
 * picture id is unknown to the pool (no board can be drawn).
 */
export function buildReplay(source: ReplaySource): NonogramReplay | null {
  const pictureId = source.picture_id ?? source.pictureId ?? "";
  const picture = getPicture(pictureId);
  if (!picture) return null;
  const size = picture.size;
  const cells = emptyBoard(size);
  const frames: CellState[][][] = [cloneBoard(cells)];
  const steps: ReplayStep[] = [];
  const mistakeSteps = new Set<number>();
  // History stack for `u`: one record per applied cell entry.
  const history: { r: number; c: number; prev: CellState }[] = [];

  const entries = (source.moves ?? "")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);

  for (const raw of entries) {
    const index = steps.length + 1;
    if (raw === "u") {
      const last = history.pop();
      if (last) cells[last.r][last.c] = last.prev;
      steps.push({
        index,
        raw,
        kind: "undo",
        r: last?.r ?? null,
        c: last?.c ?? null,
        mistake: false,
        after: last ? cells[last.r][last.c] : null,
      });
      frames.push(cloneBoard(cells));
      continue;
    }
    const hint = HINT_ENTRY.exec(raw);
    if (hint) {
      const r = Number(hint[1]);
      const c = Number(hint[2]);
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const after: CellState = hint[3] === "f" ? 1 : 2;
      history.push({ r, c, prev: cells[r][c] });
      cells[r][c] = after;
      steps.push({ index, raw, kind: "hint", r, c, mistake: false, after });
      frames.push(cloneBoard(cells));
      continue;
    }
    const m = CELL_ENTRY.exec(raw);
    if (!m) continue; // unknown entry — skip, no frame
    const r = Number(m[2]);
    const c = Number(m[3]);
    if (r < 0 || c < 0 || r >= size || c >= size) continue;
    const tag = m[1];
    const mistake = tag === "!";
    const after: CellState = tag === "f" ? 1 : tag === "x" ? 2 : 0;
    history.push({ r, c, prev: cells[r][c] });
    cells[r][c] = after;
    if (mistake) mistakeSteps.add(index);
    steps.push({
      index,
      raw,
      kind: mistake ? "mistake" : tag === "f" ? "fill" : tag === "x" ? "mark" : "erase",
      r,
      c,
      mistake,
      after,
    });
    frames.push(cloneBoard(cells));
  }

  return { picture, frames, steps, mistakeSteps, totalSteps: steps.length };
}

/** The board frame at a step (0 = empty board, clamped to range). */
export function frameAtStep(replay: NonogramReplay, step: number): CellState[][] {
  const i = Math.max(0, Math.min(replay.totalSteps, Math.floor(step)));
  return replay.frames[i];
}

/** The board frame at a point in the playback: `t` seconds into a
 *  playback that advances one step every `perStep` seconds. */
export function frameAtTime(
  replay: NonogramReplay,
  t: number,
  perStep: number,
): CellState[][] {
  if (perStep <= 0) return replay.frames[replay.totalSteps];
  return frameAtStep(replay, Math.floor(Math.max(0, t) / perStep));
}

/* ------------------------------------------------------------------ */
/* ReplayGame — the display record the History list hands to the     */
/* ReplayView / video exporter (title/subtitle/result alongside the   */
/* log). Kept in this module so both views share one shape.           */
/* ------------------------------------------------------------------ */

export interface ReplayGame {
  pictureId: string;
  /** Semicolon-joined move log (flow.ts encodeLog format). */
  moves: string;
  size?: number;
  title: string;
  subtitle: string;
  /** True when the recorded game was a win. */
  won: boolean;
  result?: "win" | "loss" | "draw";
  perfect?: boolean;
}

/** Convenience wrapper: build the replay straight from a ReplayGame. */
export function buildReplayStates(game: ReplayGame): {
  replay: NonogramReplay | null;
  states: CellState[][][];
  steps: ReplayStep[];
} {
  const replay = buildReplay({
    pictureId: game.pictureId,
    moves: game.moves,
    size: game.size,
  });
  return {
    replay,
    states: replay?.frames ?? [],
    steps: replay?.steps ?? [],
  };
}
