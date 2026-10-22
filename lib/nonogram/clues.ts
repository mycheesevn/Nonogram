/**
 * clues.ts — Nonogram clue derivation (design §3.1, §3.4).
 * Pure TypeScript, no imports.
 *
 * A bitmap is boolean[][] (true = filled). A clue is the list of run
 * lengths of filled cells in a line, in order. An empty line's clue
 * is [0] (the genre-wide convention, per design §2.1).
 */

/** Runs of `true` in one line. Empty line -> [0]. */
export function lineRuns(cells: boolean[]): number[] {
  const runs: number[] = [];
  let cur = 0;
  for (const c of cells) {
    if (c) cur++;
    else if (cur > 0) {
      runs.push(cur);
      cur = 0;
    }
  }
  if (cur > 0) runs.push(cur);
  return runs.length > 0 ? runs : [0];
}

/** Raw runs without the [0] convention: empty line -> []. */
export function lineRunsRaw(cells: boolean[]): number[] {
  const r = lineRuns(cells);
  return r.length === 1 && r[0] === 0 ? [] : r;
}

/** Derive row and column clues for a bitmap. */
export function deriveClues(bitmap: boolean[][]): {
  rows: number[][];
  cols: number[][];
} {
  const h = bitmap.length;
  const w = h > 0 ? bitmap[0].length : 0;
  const rows: number[][] = bitmap.map((row) => lineRuns(row));
  const cols: number[][] = [];
  for (let c = 0; c < w; c++) {
    const col: boolean[] = [];
    for (let r = 0; r < h; r++) col.push(bitmap[r][c]);
    cols.push(lineRuns(col));
  }
  return { rows, cols };
}

/** Does a completed line's runs match a clue exactly? */
export function lineMatchesClue(cells: boolean[], clue: number[]): boolean {
  const runs = lineRuns(cells);
  if (runs.length !== clue.length) return false;
  for (let i = 0; i < runs.length; i++) if (runs[i] !== clue[i]) return false;
  return true;
}

/** Number of filled cells in a bitmap. */
export function countFilled(bitmap: boolean[][]): number {
  let n = 0;
  for (const row of bitmap) for (const c of row) if (c) n++;
  return n;
}

/** Max run count in any row or column of a bitmap (raw runs; empty = 0). */
export function maxRuns(bitmap: boolean[][]): number {
  const { rows, cols } = deriveClues(bitmap);
  let m = 0;
  for (const clue of [...rows, ...cols]) {
    const n = clue.length === 1 && clue[0] === 0 ? 0 : clue.length;
    if (n > m) m = n;
  }
  return m;
}

/** Structural equality of two bitmaps, cell for cell. */
export function bitmapsEqual(a: boolean[][], b: boolean[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}
