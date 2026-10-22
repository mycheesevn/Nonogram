/**
 * pool.ts — accessors over the verified picture pool (pool-data.ts).
 * Pure TypeScript; imports only ./pool-data and ./clues (same folder).
 *
 * Interface contract (shared with the SQL workstream):
 * - Every picture id is `s{size}t{tier}-{k}`, k = 0..9 within its
 *   size+tier cell.
 * - POOL_BY_SIZE[size] is a flat, deterministic array of the size's
 *   30 pictures: tier 1's 10 first (k ascending), then tier 2's,
 *   then tier 3's. Race matches derive n = seed % 30 server-side and
 *   the client resolves the picture as POOL_BY_SIZE[size][n],
 *   reading the real tier from the picture itself. Daily selection
 *   indexes the same array by day-hash % 30.
 */

import { PICTURES, type NoPicture } from "./pool-data";
import { deriveClues } from "./clues";

export type { NoPicture };
export { PICTURES, PICTURES as POOL };

export const SIZES = [5, 10, 15] as const;
export type PoolSize = (typeof SIZES)[number];

/** Max clue runs allowed in any row/column, per size (design §4). */
export const MAX_RUNS: Record<PoolSize, number> = { 5: 3, 10: 4, 15: 5 };

function buildBySize(): Record<PoolSize, NoPicture[]> {
  const out: Record<PoolSize, NoPicture[]> = { 5: [], 10: [], 15: [] };
  for (const size of SIZES) {
    const cell = PICTURES.filter((p) => p.size === size);
    // PICTURES is stored tier-grouped and score-ordered within tier;
    // sort defensively by (tier, k) parsed from the id so the flat
    // order is guaranteed regardless of data-file layout.
    cell.sort((a, b) => {
      const ka = parseId(a.id);
      const kb = parseId(b.id);
      return ka.tier - kb.tier || ka.k - kb.k;
    });
    out[size] = cell;
  }
  return out;
}

function parseId(id: string): { size: number; tier: number; k: number } {
  const m = /^s(\d+)t(\d+)-(\d+)$/.exec(id);
  if (!m) throw new Error(`Malformed picture id: ${id}`);
  return { size: Number(m[1]), tier: Number(m[2]), k: Number(m[3]) };
}

/** Flat per-size arrays of 30, tier-grouped — see header contract. */
export const POOL_BY_SIZE: Record<PoolSize, NoPicture[]> = buildBySize();

/** Pictures of one size+tier cell, k ascending (10 entries). */
export function poolCell(size: PoolSize, tier: 1 | 2 | 3): NoPicture[] {
  return POOL_BY_SIZE[size].filter((p) => p.grade.tier === tier);
}

const BY_ID = new Map<string, NoPicture>(PICTURES.map((p) => [p.id, p]));

/** Look a picture up by its pool id; undefined when unknown. */
export function getPicture(id: string): NoPicture | undefined {
  return BY_ID.get(id);
}

/**
 * Resolve the n-th picture of a size (n = seed % 30, as derived
 * server-side for race matches, or day-hash % 30 for Daily).
 */
export function pictureAt(size: PoolSize, n: number): NoPicture {
  const arr = POOL_BY_SIZE[size];
  return arr[((n % arr.length) + arr.length) % arr.length];
}

/** The bitmap (boolean grid) a picture encodes: art char !== '.'. */
export function pictureBitmap(p: NoPicture): boolean[][] {
  return p.art.map((row) => [...row].map((ch) => ch !== "."));
}

/** Row/column clues for a picture, derived from its bitmap. */
export function pictureClues(p: NoPicture): {
  rows: number[][];
  cols: number[][];
} {
  return deriveClues(pictureBitmap(p));
}

/**
 * Difficulty score used for tier assignment (design §3.3), exported
 * so tooling can reproduce the grading:
 *   score = 3*solveRounds + 10*hardLineRatio + 2*density
 * (rounds = cross-line iteration depth; hardLineRatio = share of
 * lines needing overlap reasoning; density = filled-cell share).
 */
export function difficultyScore(g: NoPicture["grade"]): number {
  return 3 * g.solveRounds + 10 * g.hardLineRatio + 2 * g.density;
}
