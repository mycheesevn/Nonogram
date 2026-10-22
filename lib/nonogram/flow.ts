/**
 * flow.ts — Nonogram game flow / state (design §5). Pure logic, no DOM.
 * No imports outside this folder (imports ./clues only for equality).
 *
 * Rules implemented (locked decisions, design §2.2 / §5):
 * - 3 cell states: 0 unknown, 1 filled, 2 marked (✕ personal note).
 * - Paint modes: 'fill' | 'mark' | 'erase'. Fill/mark toggle when
 *   re-applied to a cell already in that state.
 * - Wrong FILL (solution cell is empty): mistakes++, the cell
 *   reverts to unknown. 3 mistakes = loss.
 * - Wrong MARK (✕ on a solution-filled cell): NEVER counts as a
 *   mistake — ✕ is a personal note and it stays as placed.
 * - A drag stroke is ONE undo unit (beginStroke/endStroke).
 *   A paint outside an explicit stroke is its own unit.
 * - Hints: at most MAX_HINTS (3) free per game.
 * - Win: the player's filled set equals the solution's filled set.
 * - Perfect: won with 0 mistakes and 0 hints used.
 * - Move log: compact replay encoding (see encodeLog).
 */

export type CellState = 0 | 1 | 2;
export type PaintMode = "fill" | "mark" | "erase";

export const MAX_MISTAKES = 3;
export const MAX_HINTS = 3;

export interface CellChange {
  r: number;
  c: number;
  before: CellState;
  after: CellState;
  /** This change was a wrong fill (mistake already counted). */
  mistake: boolean;
}

interface Stroke {
  changes: CellChange[];
  mistakes: number;
}

export type GameStatus = "playing" | "won" | "lost";

export class NonogramGame {
  readonly size: number;
  readonly solution: boolean[][];
  /** Player grid: 0 unknown, 1 filled, 2 marked. */
  cells: CellState[][];
  mistakes = 0;
  hintsUsed = 0;
  status: GameStatus = "playing";

  private undoStack: Stroke[] = [];
  private openStroke: Stroke | null = null;
  private log: string[] = [];

  // Elapsed-time hooks (caller supplies the clock; no Date.now inside
  // except as an overridable default so tests stay deterministic).
  private startedAt: number | null = null;
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  private endedAt: number | null = null;

  constructor(solution: boolean[][], opts?: { now?: number }) {
    this.size = solution.length;
    this.solution = solution.map((row) => row.slice());
    this.cells = Array.from({ length: this.size }, () =>
      new Array<CellState>(this.size).fill(0),
    );
    if (opts?.now !== undefined) this.startedAt = opts.now;
  }

  // -------------------------------------------------------------------------
  // Timer hooks
  // -------------------------------------------------------------------------

  startClock(now: number): void {
    if (this.startedAt === null) this.startedAt = now;
  }

  pauseClock(now: number): void {
    if (this.pausedAt === null && this.startedAt !== null) this.pausedAt = now;
  }

  resumeClock(now: number): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += now - this.pausedAt;
      this.pausedAt = null;
    }
  }

  /** Elapsed playing milliseconds, excluding paused spans. */
  elapsedMs(now: number): number {
    if (this.startedAt === null) return 0;
    const end = this.endedAt ?? (this.pausedAt !== null ? this.pausedAt : now);
    return Math.max(0, end - this.startedAt - this.pausedTotal);
  }

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  beginStroke(): void {
    if (!this.openStroke) this.openStroke = { changes: [], mistakes: 0 };
  }

  endStroke(): void {
    if (this.openStroke) {
      if (this.openStroke.changes.length > 0 || this.openStroke.mistakes > 0) {
        this.undoStack.push(this.openStroke);
      }
      this.openStroke = null;
    }
  }

  get undoDepth(): number {
    return this.undoStack.length + (this.openStroke ? 1 : 0);
  }

  /**
   * Apply the current paint mode to one cell. Returns the change, or
   * null for a no-op (e.g. erasing an unknown cell, marking a filled
   * cell, painting after the game ended).
   */
  paint(r: number, c: number, mode: PaintMode): CellChange | null {
    if (this.status !== "playing") return null;
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    const before = this.cells[r][c];
    let after: CellState = before;
    let mistake = false;

    if (mode === "fill") {
      if (before === 1) {
        after = 0; // toggle off
      } else if (this.solution[r][c]) {
        after = 1;
      } else {
        // Wrong fill: counts, flashes, reverts to unknown (design §2.2).
        mistake = true;
        after = 0;
      }
    } else if (mode === "mark") {
      if (before === 2) after = 0; // toggle off
      else if (before === 0) after = 2; // note — never checked, never penalised
      else return null; // cannot mark a filled cell
    } else {
      // erase
      if (before === 0) return null;
      after = 0;
    }

    if (after === before && !mistake) return null;

    const ownStroke = !this.openStroke;
    if (ownStroke) this.beginStroke();
    this.cells[r][c] = after;
    if (mistake) {
      this.mistakes++;
      this.openStroke!.mistakes++;
    }
    const change: CellChange = { r, c, before, after, mistake };
    // Coalesce repeated touches of one cell inside a stroke: keep the
    // ORIGINAL before-value so one undo restores the pre-stroke state.
    const existing = this.openStroke!.changes.find((x) => x.r === r && x.c === c);
    if (existing) {
      existing.after = after;
      existing.mistake = existing.mistake || mistake;
    } else {
      this.openStroke!.changes.push(change);
    }
    this.log.push(encodeEntry(change));
    if (ownStroke) this.endStroke();

    this.refreshStatus();
    return change;
  }

  /** Drag-paint a list of cells with one mode, as a single undo unit. */
  paintStroke(cells: { r: number; c: number }[], mode: PaintMode): CellChange[] {
    this.beginStroke();
    const out: CellChange[] = [];
    for (const { r, c } of cells) {
      const ch = this.paint(r, c, mode);
      if (ch) out.push(ch);
    }
    this.endStroke();
    return out;
  }

  undo(): boolean {
    this.endStroke();
    const stroke = this.undoStack.pop();
    if (!stroke) return false;
    for (let i = stroke.changes.length - 1; i >= 0; i--) {
      const ch = stroke.changes[i];
      this.cells[ch.r][ch.c] = ch.before;
    }
    this.mistakes -= stroke.mistakes;
    if (this.mistakes < 0) this.mistakes = 0;
    this.log.push("u");
    if (this.status !== "playing") {
      // Undoing out of a terminal state can only happen from 'won'
      // by removing fills — mistakes are refunded by the undo itself.
      this.status = "playing";
      this.endedAt = null;
    }
    this.refreshStatusAfterUndo();
    return true;
  }

  // -------------------------------------------------------------------------
  // Hints
  // -------------------------------------------------------------------------

  get hintsRemaining(): number {
    return Math.max(0, MAX_HINTS - this.hintsUsed);
  }

  /**
   * Register a hint and (when the caller resolved one) apply the
   * revealed cell. `value` 1 = fill, 2 = mark-empty. A hinted fill
   * is by construction correct, so it never counts as a mistake.
   * Returns false when the free-hint budget is exhausted.
   */
  useHint(r?: number, c?: number, value?: 1 | 2): boolean {
    if (this.status !== "playing") return false;
    if (this.hintsUsed >= MAX_HINTS) return false;
    this.hintsUsed++;
    if (r !== undefined && c !== undefined && value !== undefined) {
      const before = this.cells[r][c];
      if (before !== value) {
        this.beginStroke();
        this.cells[r][c] = value;
        this.openStroke!.changes.push({ r, c, before, after: value, mistake: false });
        this.log.push(`h${r},${c}=${value === 1 ? "f" : "x"}`);
        this.endStroke();
      }
    }
    this.refreshStatus();
    return true;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Win = filled set identical to the solution's filled set. */
  isWin(): boolean {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if ((this.cells[r][c] === 1) !== this.solution[r][c]) return false;
      }
    }
    return true;
  }

  /** Perfect game: no mistakes, no hints (badge condition, §5/§6.5). */
  get perfect(): boolean {
    return this.mistakes === 0 && this.hintsUsed === 0;
  }

  private refreshStatus(): void {
    if (this.status !== "playing") return;
    if (this.isWin()) {
      this.status = "won"; // clock is frozen by the caller via finishClock(now)
    } else if (this.mistakes >= MAX_MISTAKES) {
      this.status = "lost";
    }
  }

  private refreshStatusAfterUndo(): void {
    if (this.mistakes < MAX_MISTAKES && !this.isWin()) this.status = "playing";
  }

  /** Give up: the game is lost immediately (reason recorded by the caller). */
  resign(now?: number): void {
    if (this.status !== "playing") return;
    this.status = "lost";
    if (now !== undefined) this.finishClock(now);
  }

  /** Freeze the clock at a caller-supplied timestamp (win/loss). */
  finishClock(now: number): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += now - this.pausedAt;
      this.pausedAt = null;
    }
    this.endedAt = now;
  }

  /** Correct fills so far / total solution fills — race progress %. */
  progress(): { correct: number; total: number; pct: number } {
    let correct = 0;
    let total = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.solution[r][c]) {
          total++;
          if (this.cells[r][c] === 1) correct++;
        }
      }
    }
    return { correct, total, pct: total === 0 ? 100 : (correct / total) * 100 };
  }

  // -------------------------------------------------------------------------
  // Move log (replay)
  // -------------------------------------------------------------------------

  /**
   * Compact log, semicolon-joined entries:
   *   f<r>,<c>   fill        x<r>,<c>   mark (✕)
   *   e<r>,<c>   back to unknown (toggle/erase)
   *   !<r>,<c>   wrong fill (mistake)
   *   h<r>,<c>=f|x  hint reveal
   *   u          undo of the previous stroke
   */
  encodeLog(): string {
    return this.log.join(";");
  }

  get logEntries(): string[] {
    return this.log.slice();
  }
}

function encodeEntry(ch: CellChange): string {
  if (ch.mistake) return `!${ch.r},${ch.c}`;
  if (ch.after === 1) return `f${ch.r},${ch.c}`;
  if (ch.after === 2) return `x${ch.r},${ch.c}`;
  return `e${ch.r},${ch.c}`;
}

/** Factory mirroring the family's create-game style. */
export function createGame(solution: boolean[][], opts?: { now?: number }): NonogramGame {
  return new NonogramGame(solution, opts);
}
