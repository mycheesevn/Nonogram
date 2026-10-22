"use client";

/** Nonogram board (SVG): clue gutters top + left, square play grid.
 *  Pointer-driven drag painting is handled by the parent through
 *  onPaintStart/onPaintEnter/onPaintEnd (axis lock lives there).
 *  When `revealed` (a finished picture) is passed, the grid renders
 *  the COLOR art instead of the play state — the win moment. */
import type { CellState } from "@/lib/nonogram/flow";
import { lineRunsRaw } from "@/lib/nonogram/clues";
import type { NoPicture } from "@/lib/nonogram/pool-data";

const CELL = 100;
const CLUE = 52; // one clue number slot
const PAD = 6;

export interface FlashCell {
  r: number;
  c: number;
  key: number;
}

interface BoardProps {
  size: number;
  rowClues: number[][];
  colClues: number[][];
  cells: CellState[][];
  onPaintStart?: (r: number, c: number) => void;
  onPaintEnter?: (r: number, c: number) => void;
  onPaintEnd?: () => void;
  /** Right-click quick mark at a cell. */
  onQuickMark?: (r: number, c: number) => void;
  highlight?: { r: number; c: number } | null;
  flash?: FlashCell | null;
  revealed?: NoPicture | null;
  disabled?: boolean;
  /** Lesson target cell (pulsing outline), index = r*size+c. */
  target?: number | null;
  /** Extra cells to outline (lesson pattern cells), same indexing. */
  patternCells?: number[];
}

/** A clue dims when the line's filled runs already match it exactly. */
function lineDone(cells: CellState[], clue: number[]): boolean {
  const filled = cells.map((v) => v === 1);
  const runs = lineRunsRaw(filled);
  const want = clue.filter((n) => n > 0);
  if (runs.length !== want.length) return false;
  return runs.every((n, i) => n === want[i]);
}

export default function Board({
  size,
  rowClues,
  colClues,
  cells,
  onPaintStart,
  onPaintEnter,
  onPaintEnd,
  onQuickMark,
  highlight,
  flash,
  revealed,
  disabled,
  target,
  patternCells,
}: BoardProps) {
  const rowDepth = Math.max(1, ...rowClues.map((c) => c.length));
  const colDepth = Math.max(1, ...colClues.map((c) => c.length));
  const gx = rowDepth * CLUE + PAD; // grid origin x
  const gy = colDepth * CLUE + PAD; // grid origin y
  const W = gx + size * CELL + PAD;
  const H = gy + size * CELL + PAD;

  const cellFromEvent = (e: React.PointerEvent): { r: number; c: number } | null => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const c = Math.floor((x - gx) / CELL);
    const r = Math.floor((y - gy) / CELL);
    if (r < 0 || c < 0 || r >= size || c >= size) return null;
    return { r, c };
  };

  const rowDone = rowClues.map((clue, r) => lineDone(cells[r] ?? [], clue));
  const colDone = colClues.map((clue, c) =>
    lineDone(
      cells.map((row) => row[c] ?? 0),
      clue,
    ),
  );
  const pattern = new Set(patternCells ?? []);
  const artRows = revealed ? revealed.art : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="sud-board-svg no-board"
      role="img"
      aria-label="Nonogram board"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        if (disabled || !onPaintStart) return;
        const cell = cellFromEvent(e);
        if (!cell) return;
        (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
        if (e.button === 2 && onQuickMark) {
          onQuickMark(cell.r, cell.c);
          return;
        }
        onPaintStart(cell.r, cell.c);
      }}
      onPointerMove={(e) => {
        if (disabled || !onPaintEnter) return;
        const cell = cellFromEvent(e);
        if (cell) onPaintEnter(cell.r, cell.c);
      }}
      onPointerUp={() => {
        if (!disabled && onPaintEnd) onPaintEnd();
      }}
      onPointerCancel={() => {
        if (onPaintEnd) onPaintEnd();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* gutter backgrounds */}
      <rect x={0} y={gy} width={gx} height={size * CELL} fill="#fdf2f8" />
      <rect x={gx} y={0} width={size * CELL} height={gy} fill="#fdf2f8" />
      <rect x={0} y={0} width={gx} height={gy} fill="#fdf2f8" />

      {/* row/col highlight */}
      {highlight && !revealed && (
        <>
          <rect x={gx} y={gy + highlight.r * CELL} width={size * CELL} height={CELL} fill="#fbcfe8" opacity={0.45} />
          <rect x={gx + highlight.c * CELL} y={gy} width={CELL} height={size * CELL} fill="#fbcfe8" opacity={0.45} />
        </>
      )}

      {/* cells */}
      {Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_, c) => {
          const x = gx + c * CELL;
          const y = gy + r * CELL;
          if (artRows) {
            const ch = artRows[r]?.[c] ?? ".";
            const fill = ch === "." ? "#f8fafc" : revealed!.palette[ch] ?? "#db2777";
            return <rect key={`a${r}-${c}`} x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} rx={10} fill={fill} />;
          }
          const v = cells[r]?.[c] ?? 0;
          return (
            <g key={`c${r}-${c}`}>
              <rect x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} rx={10} fill={v === 1 ? "#db2777" : "#ffffff"} />
              {v === 2 && (
                <path
                  d={`M ${x + 26} ${y + 26} L ${x + CELL - 26} ${y + CELL - 26} M ${x + CELL - 26} ${y + 26} L ${x + 26} ${y + CELL - 26}`}
                  stroke="#94a3b8"
                  strokeWidth={9}
                  strokeLinecap="round"
                />
              )}
              {flash && flash.r === r && flash.c === c && (
                <rect
                  key={flash.key}
                  x={x + 1}
                  y={y + 1}
                  width={CELL - 2}
                  height={CELL - 2}
                  rx={10}
                  fill="#dc2626"
                  className="no-flash"
                />
              )}
              {target !== null && target !== undefined && target === r * size + c && (
                <rect x={x + 4} y={y + 4} width={CELL - 8} height={CELL - 8} rx={10} fill="none" stroke="#f59e0b" strokeWidth={6} className="no-target-pulse" />
              )}
              {pattern.has(r * size + c) && (
                <rect x={x + 7} y={y + 7} width={CELL - 14} height={CELL - 14} rx={8} fill="none" stroke="#38bdf8" strokeWidth={4} />
              )}
            </g>
          );
        }),
      )}

      {/* grid lines: thin, bold every 5 */}
      {Array.from({ length: size + 1 }, (_, k) => (
        <g key={`gl${k}`} stroke={k % 5 === 0 ? "#64748b" : "#e2e8f0"} strokeWidth={k % 5 === 0 ? 4 : 2}>
          <line x1={gx + k * CELL} y1={gy} x2={gx + k * CELL} y2={gy + size * CELL} />
          <line x1={gx} y1={gy + k * CELL} x2={gx + size * CELL} y2={gy + k * CELL} />
        </g>
      ))}
      <rect x={gx} y={gy} width={size * CELL} height={size * CELL} fill="none" stroke="#475569" strokeWidth={5} />

      {/* row clues (right-aligned in the left gutter) */}
      {!revealed &&
        rowClues.map((clue, r) =>
          clue.map((n, i) => (
            <text
              key={`rc${r}-${i}`}
              x={gx - PAD - (clue.length - 1 - i) * CLUE - CLUE / 2}
              y={gy + r * CELL + CELL / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={40}
              fontWeight={600}
              fill={rowDone[r] ? "#cbd5e1" : "#334155"}
            >
              {n}
            </text>
          )),
        )}
      {/* column clues (bottom-aligned in the top gutter) */}
      {!revealed &&
        colClues.map((clue, c) =>
          clue.map((n, i) => (
            <text
              key={`cc${c}-${i}`}
              x={gx + c * CELL + CELL / 2}
              y={gy - PAD - (clue.length - 1 - i) * CLUE - CLUE / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={40}
              fontWeight={600}
              fill={colDone[c] ? "#cbd5e1" : "#334155"}
            >
              {n}
            </text>
          )),
        )}
    </svg>
  );
}
