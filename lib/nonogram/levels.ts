/** Player XP levels (account progression, NOT puzzle difficulty —
 *  puzzle difficulty is size × tier in pool.ts). Thresholds are the
 *  family-standard ladder shared with Sudoku. */

export const LEVEL_THRESHOLDS = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000,
];

export function levelForXp(xp: number): number {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

export interface LevelProgress {
  level: number;
  /** 0..1 progress into the current level (for the header ring). */
  prog: number;
  into: number;
  needed: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const cur = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const next = LEVEL_THRESHOLDS[level];
  if (next === undefined || next <= cur) {
    return { level, prog: 1, into: xp - cur, needed: 1 };
  }
  return {
    level,
    prog: Math.min(1, Math.max(0, (xp - cur) / (next - cur))),
    into: xp - cur,
    needed: next - cur,
  };
}
