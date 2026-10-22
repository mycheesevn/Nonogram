/**
 * solver.ts — Two-tier Nonogram solver (design §3.2).
 * Pure TypeScript; imports only ./clues (same folder).
 *
 * Tier 1 — line solver: for every row/column enumerate all placements
 * of its clue runs that are consistent with the cells already known;
 * a cell filled in EVERY placement is forced filled, a cell empty in
 * every placement is forced empty. Iterate to a fixpoint.
 *
 * Tier 2 — solution counter: DFS over the most-constrained undecided
 * line, using the line solver as constraint propagation after every
 * guess, counting at most `cap` solutions. A step budget guards
 * against pathological searches (returns `budgetExceeded: true`).
 *
 * Cell knowledge encoding: 0 = unknown, 1 = filled, 2 = empty.
 */

import { deriveClues, countFilled } from "./clues";

export type Known = 0 | 1 | 2;
export type KnownGrid = Known[][];

/**
 * A line is "hard" when its initial number of feasible placements
 * (nothing known) exceeds this threshold: the player cannot pin any
 * cell from that line alone without cross-line information.
 * 10 is chosen because a single run in a 10/15 line yields at most
 * `length` placements, so only multi-run (or very short-run) lines —
 * the ones that genuinely need overlap reasoning — count as hard.
 */
export const HARD_LINE_PLACEMENT_THRESHOLD = 10;

/** Hard cap on DFS nodes in countSolutions, so nothing can hang. */
export const COUNT_STEP_BUDGET = 20000;

// ---------------------------------------------------------------------------
// Placement generation (cached)
// ---------------------------------------------------------------------------

const placementCache = new Map<string, boolean[][]>();

/**
 * All placements of `clue` in a line of `length` consistent with
 * `known` (0 unknown, 1 must be filled, 2 must be empty).
 * A placement is boolean[] (true = filled). Clue [0] means no fills.
 * Results are cached by (clue, length, known) — placements for a
 * 15-cell multi-run line are the hot path of both solver tiers.
 */
export function generateLinePlacements(
  clue: number[],
  length: number,
  known: Known[],
): boolean[][] {
  const runs =
    clue.length === 1 && clue[0] === 0 ? [] : clue.filter((n) => n > 0);
  const key = runs.join(",") + "|" + length + "|" + known.join("");
  const hit = placementCache.get(key);
  if (hit) return hit;

  const out: boolean[][] = [];
  const cur: boolean[] = new Array<boolean>(length).fill(false);

  // Minimum cells needed from position `pos` for runs[idx..].
  const suffixMin: number[] = new Array(runs.length + 1).fill(0);
  for (let i = runs.length - 1; i >= 0; i--) {
    suffixMin[i] = runs[i] + (i + 1 < runs.length ? 1 + suffixMin[i + 1] : 0);
  }

  const consistent = (placement: boolean[]): boolean => {
    for (let i = 0; i < length; i++) {
      if (known[i] === 1 && !placement[i]) return false;
      if (known[i] === 2 && placement[i]) return false;
    }
    return true;
  };

  const rec = (idx: number, pos: number): void => {
    if (idx === runs.length) {
      const placement = cur.slice();
      if (consistent(placement)) out.push(placement);
      return;
    }
    const run = runs[idx];
    const maxStart = length - suffixMin[idx];
    for (let s = pos; s <= maxStart; s++) {
      // Place run at s..s+run-1 (cells before s stay empty in `cur`).
      for (let i = s; i < s + run; i++) cur[i] = true;
      rec(idx + 1, s + run + 1);
      for (let i = s; i < s + run; i++) cur[i] = false;
      // If the cell at s is known-filled, no later start can work:
      // this run (or an earlier one, already fixed) must cover it,
      // and earlier runs end before pos <= s.
      if (known[s] === 1) break;
    }
  };
  rec(0, 0);

  placementCache.set(key, out);
  return out;
}

/** Clear the placement cache (tests / memory hygiene). */
export function clearPlacementCache(): void {
  placementCache.clear();
}

// ---------------------------------------------------------------------------
// Line propagation
// ---------------------------------------------------------------------------

function emptyGrid(size: number): KnownGrid {
  return Array.from({ length: size }, () =>
    new Array<Known>(size).fill(0),
  );
}

function cloneGrid(g: KnownGrid): KnownGrid {
  return g.map((row) => row.slice() as Known[]);
}

function getLine(grid: KnownGrid, isRow: boolean, idx: number): Known[] {
  if (isRow) return grid[idx].slice();
  const col: Known[] = [];
  for (let r = 0; r < grid.length; r++) col.push(grid[r][idx]);
  return col;
}

function setLineCell(
  grid: KnownGrid,
  isRow: boolean,
  idx: number,
  pos: number,
  v: Known,
): void {
  if (isRow) grid[idx][pos] = v;
  else grid[pos][idx] = v;
}

interface PropResult {
  grid: KnownGrid;
  solved: boolean;
  contradiction: boolean;
  /** Full sweeps performed, including the final no-change sweep. */
  rounds: number;
}

/**
 * Propagate line constraints from `start` to a fixpoint.
 * The caller's grid is not mutated.
 */
function propagate(
  rowClues: number[][],
  colClues: number[][],
  size: number,
  start: KnownGrid,
): PropResult {
  const grid = cloneGrid(start);
  let rounds = 0;
  for (;;) {
    rounds++;
    let changed = false;
    let contradiction = false;
    for (let pass = 0; pass < 2 && !contradiction; pass++) {
      const isRow = pass === 0;
      const clues = isRow ? rowClues : colClues;
      for (let li = 0; li < size; li++) {
        const line = getLine(grid, isRow, li);
        const placements = generateLinePlacements(clues[li], size, line);
        if (placements.length === 0) {
          contradiction = true;
          break;
        }
        for (let p = 0; p < size; p++) {
          if (line[p] !== 0) continue;
          let allFilled = true;
          let allEmpty = true;
          for (const pl of placements) {
            if (pl[p]) allEmpty = false;
            else allFilled = false;
            if (!allFilled && !allEmpty) break;
          }
          if (allFilled) {
            setLineCell(grid, isRow, li, p, 1);
            changed = true;
          } else if (allEmpty) {
            setLineCell(grid, isRow, li, p, 2);
            changed = true;
          }
        }
      }
    }
    if (contradiction) return { grid, solved: false, contradiction: true, rounds };
    if (!changed) break;
    if (rounds > size * 4 + 10) break; // safety: a sweep always fixes >=1 cell
  }
  let solved = true;
  for (const row of grid)
    for (const v of row)
      if (v === 0) {
        solved = false;
        break;
      }
  return { grid, solved, contradiction: false, rounds };
}

/** Fraction of lines whose initial placement count exceeds the threshold. */
export function computeHardLineRatio(
  rowClues: number[][],
  colClues: number[][],
  size: number,
): number {
  const blank: Known[] = new Array<Known>(size).fill(0);
  let hard = 0;
  let total = 0;
  for (const clues of [rowClues, colClues]) {
    for (const clue of clues) {
      total++;
      if (
        generateLinePlacements(clue, size, blank).length >
        HARD_LINE_PLACEMENT_THRESHOLD
      )
        hard++;
    }
  }
  return total === 0 ? 0 : hard / total;
}

// ---------------------------------------------------------------------------
// Public tier-1 API
// ---------------------------------------------------------------------------

export interface LineSolveResult {
  solved: boolean;
  rounds: number;
  grid: KnownGrid;
  hardLineRatio: number;
}

/**
 * Solve by line propagation alone, starting from a blank grid.
 * `rounds` = full row+column sweeps to fixpoint (including the final
 * confirming sweep). `grid` uses 0/1/2 encoding; on an unsolved
 * puzzle it holds every cell line logic can force.
 */
export function lineSolve(
  rowClues: number[][],
  colClues: number[][],
  size: number,
): LineSolveResult {
  const hardLineRatio = computeHardLineRatio(rowClues, colClues, size);
  const res = propagate(rowClues, colClues, size, emptyGrid(size));
  return {
    solved: res.solved && !res.contradiction,
    rounds: res.rounds,
    grid: res.grid,
    hardLineRatio,
  };
}

// ---------------------------------------------------------------------------
// Public tier-2 API: uniqueness prover
// ---------------------------------------------------------------------------

export interface CountResult {
  /** Number of solutions found, capped at `cap`. */
  count: number;
  /** First solution found (boolean bitmap), if any. */
  solution?: boolean[][];
  /** True when the step budget stopped the search early. */
  budgetExceeded: boolean;
  /** DFS nodes visited (diagnostics / fuzz timing). */
  steps: number;
}

/**
 * Count solutions of a clue set, stopping at `cap` (default 2 —
 * exactly what the uniqueness gate needs). DFS chooses the
 * undecided line with the fewest feasible placements (>1) and
 * branches on its first undecided cell, propagating line
 * constraints after each guess.
 */
export function countSolutions(
  rowClues: number[][],
  colClues: number[][],
  size: number,
  cap = 2,
): CountResult {
  let steps = 0;
  let count = 0;
  let budgetExceeded = false;
  let firstSolution: boolean[][] | undefined;

  const dfs = (start: KnownGrid): void => {
    if (count >= cap || budgetExceeded) return;
    steps++;
    if (steps > COUNT_STEP_BUDGET) {
      budgetExceeded = true;
      return;
    }
    const res = propagate(rowClues, colClues, size, start);
    if (res.contradiction) return;
    if (res.solved) {
      count++;
      if (!firstSolution) {
        firstSolution = res.grid.map((row) => row.map((v) => v === 1));
      }
      return;
    }
    // Most-constrained undecided line: fewest placements (> 1).
    let bestGrid = res.grid;
    let bestCell: { r: number; c: number } | null = null;
    let bestPlacements = Infinity;
    for (let pass = 0; pass < 2; pass++) {
      const isRow = pass === 0;
      const clues = isRow ? rowClues : colClues;
      for (let li = 0; li < size; li++) {
        const line = getLine(res.grid, isRow, li);
        if (!line.includes(0)) continue;
        const n = generateLinePlacements(clues[li], size, line).length;
        if (n > 1 && n < bestPlacements) {
          const pos = line.indexOf(0);
          bestPlacements = n;
          bestCell = isRow ? { r: li, c: pos } : { r: pos, c: li };
        }
      }
    }
    if (!bestCell) return; // undecided cells but every line is forced?! (cannot happen post-propagate)
    for (const v of [1, 2] as Known[]) {
      if (count >= cap || budgetExceeded) return;
      const next = cloneGrid(bestGrid);
      next[bestCell.r][bestCell.c] = v;
      dfs(next);
    }
  };

  dfs(emptyGrid(size));
  return { count, solution: firstSolution, budgetExceeded, steps };
}

// ---------------------------------------------------------------------------
// Picture analysis — the pool gate (design §3.3)
// ---------------------------------------------------------------------------

export interface PictureAnalysis {
  solutions: number;
  lineSolvable: boolean;
  solveRounds: number;
  hardLineRatio: number;
  density: number;
  budgetExceeded: boolean;
}

/** Full gate metrics for one bitmap. */
export function analyzePicture(bitmap: boolean[][]): PictureAnalysis {
  const size = bitmap.length;
  const { rows, cols } = deriveClues(bitmap);
  const ls = lineSolve(rows, cols, size);
  const cs = countSolutions(rows, cols, size, 2);
  const total = size * size;
  return {
    solutions: cs.count,
    lineSolvable: ls.solved,
    solveRounds: ls.rounds,
    hardLineRatio: ls.hardLineRatio,
    density: total === 0 ? 0 : countFilled(bitmap) / total,
    budgetExceeded: cs.budgetExceeded,
  };
}

// ---------------------------------------------------------------------------
// Hints (design §3.2 / §5): the next forced cell
// ---------------------------------------------------------------------------

export type HintReason = "overlap" | "edge" | "complete-count" | "cross";

export interface ForcedCell {
  r: number;
  c: number;
  /** 1 = forced filled, 2 = forced empty. */
  value: 1 | 2;
  reason: HintReason;
}

/**
 * One line in isolation: cells forced by this line's placements
 * given only this line's known cells. Returns positions in the line.
 */
function isolatedForced(
  clue: number[],
  line: Known[],
): { pos: number; value: 1 | 2 }[] {
  const placements = generateLinePlacements(clue, line.length, line);
  if (placements.length === 0) return [];
  const out: { pos: number; value: 1 | 2 }[] = [];
  for (let p = 0; p < line.length; p++) {
    if (line[p] !== 0) continue;
    let allFilled = true;
    let allEmpty = true;
    for (const pl of placements) {
      if (pl[p]) allEmpty = false;
      else allFilled = false;
    }
    if (allFilled) out.push({ pos: p, value: 1 });
    else if (allEmpty) out.push({ pos: p, value: 2 });
  }
  return out;
}

function classifyIsolated(clue: number[], size: number, pos: number): HintReason {
  const runs = clue.length === 1 && clue[0] === 0 ? [] : clue;
  const needed =
    runs.reduce((a, b) => a + b, 0) + Math.max(0, runs.length - 1);
  if (needed === size) return "complete-count";
  // Edge: the forced cell sits inside the reach of the first/last run
  // measured from a board edge — the edge anchored the overlap.
  if (runs.length > 0 && (pos < runs[0] || pos >= size - runs[runs.length - 1]))
    return "edge";
  return "overlap";
}

/**
 * Find the next cell that line logic forces, given the player's
 * current knowledge. `known` is the player's grid (0 unknown,
 * 1 filled, 2 marked/empty) — the caller passes ONLY player-known
 * cells; the hidden solution is never consulted here.
 *
 * Strategy: first look for a cell forced by a single row/column in
 * isolation (reason: complete-count / edge / overlap). If none,
 * run full cross-line propagation — a cell forced only by combining
 * a row and a column gets reason 'cross'. Returns null when line
 * logic forces nothing new (caller falls back to revealing a
 * solution cell, per design §5).
 */
export function nextForcedCell(state: {
  rowClues: number[][];
  colClues: number[][];
  size: number;
  known: KnownGrid;
}): ForcedCell | null {
  const { rowClues, colClues, size, known } = state;

  for (let pass = 0; pass < 2; pass++) {
    const isRow = pass === 0;
    const clues = isRow ? rowClues : colClues;
    for (let li = 0; li < size; li++) {
      const line = getLine(known, isRow, li);
      if (!line.includes(0)) continue;
      const forced = isolatedForced(clues[li], line);
      if (forced.length > 0) {
        const f = forced[0];
        return {
          r: isRow ? li : f.pos,
          c: isRow ? f.pos : li,
          value: f.value,
          reason: classifyIsolated(clues[li], size, f.pos),
        };
      }
    }
  }

  const res = propagate(rowClues, colClues, size, known);
  if (res.contradiction) return null;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (known[r][c] === 0 && res.grid[r][c] !== 0) {
        return { r, c, value: res.grid[r][c] as 1 | 2, reason: "cross" };
      }
    }
  }
  return null;
}
