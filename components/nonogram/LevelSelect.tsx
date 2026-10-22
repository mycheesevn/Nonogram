"use client";

/** Size × difficulty pickers for Nonogram. Two segmented rows —
 *  deliberately NOT a select box: sizes and tiers are the game's
 *  primary axes and deserve one-tap switches (the Sudoku combo-box
 *  lesson was about digit pads; there is no digit pad here). */
import type { PoolSize } from "@/lib/nonogram/pool";

export function SizeTierSelect({
  size,
  tier,
  onSize,
  onTier,
  sizeLabel,
  tierLabel,
  tierNames,
}: {
  size: PoolSize;
  tier: 1 | 2 | 3;
  onSize: (s: PoolSize) => void;
  onTier: (t: 1 | 2 | 3) => void;
  sizeLabel: string;
  tierLabel: string;
  /** 1-indexed tier names: ["", Easy, Medium, Hard]. */
  tierNames: string[];
}) {
  return (
    <div className="no-pickers">
      <div className="sud-seg" role="group" aria-label={sizeLabel}>
        {([5, 10, 15] as PoolSize[]).map((sz) => (
          <button
            key={sz}
            type="button"
            className={size === sz ? "active" : ""}
            onClick={() => onSize(sz)}
          >
            {sz}×{sz}
          </button>
        ))}
      </div>
      <div className="sud-seg" role="group" aria-label={tierLabel}>
        {([1, 2, 3] as const).map((tr) => (
          <button
            key={tr}
            type="button"
            className={tier === tr ? "active" : ""}
            onClick={() => onTier(tr)}
          >
            {tierNames[tr] ?? tr}
          </button>
        ))}
      </div>
    </div>
  );
}
