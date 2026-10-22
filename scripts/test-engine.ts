/**
 * test-engine.ts — engine test battery (design §3.5).
 *
 * Run from this folder:
 *   npx -y tsx test-engine.ts
 * (tsx is fetched by npx; no local node_modules needed. Exits 0 on
 * success, 1 on the first failed battery, printing a summary.)
 *
 * Covers: (a) clue derivation incl. [0] lines and the design's
 * `4 1 3` example; (b) the intentionally ambiguous 2x2 checkerboard
 * is rejected; (c) all 90 pool pictures pass the full gate and the
 * solver reproduces the original bitmap cell-for-cell; (d) fuzz —
 * 200 seeded random bitmaps per size at densities 0.3/0.5/0.7 never
 * hang and never report a wrong unique solution; (e) flow rules —
 * wrong fill counts + reverts, wrong mark never counts, a drag
 * stroke is one undo unit, win detection, perfect flag.
 */

declare const process: { exit(code: number): never };

import { deriveClues, lineRuns, bitmapsEqual, maxRuns } from "../lib/nonogram/clues";
import {
  analyzePicture,
  countSolutions,
  lineSolve,
  nextForcedCell,
  generateLinePlacements,
  type Known,
} from "../lib/nonogram/solver";
import { PICTURES, POOL_BY_SIZE, pictureAt, pictureBitmap, MAX_RUNS } from "../lib/nonogram/pool";
import { NonogramGame, MAX_MISTAKES, MAX_HINTS } from "../lib/nonogram/flow";

let passed = 0;
let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function section(name: string): void {
  console.log(`\n== ${name}`);
}

// ---------------------------------------------------------------- (a) clues
section("(a) clue derivation");
{
  // Design §2.1 example: a 10-cell row with runs 4, 1, 3.
  const row = [..."####.#.###"].map((ch) => ch === "#");
  check(eq(lineRuns(row), [4, 1, 3]), "lineRuns ####.#.### -> [4,1,3]");

  // A bitmap with an empty row and empty column -> [0] clues.
  const bmp = [
    [true, false, false],
    [false, false, false],
    [true, true, false],
  ];
  const { rows, cols } = deriveClues(bmp);
  check(eq(rows[1], [0]), "empty row clue is [0]");
  check(eq(cols[2], [0]), "empty column clue is [0]");
  check(eq(rows[0], [1]) && eq(rows[2], [2]), "row clues [1] and [2]");
  check(eq(cols[0], [1, 1]) && eq(cols[1], [1]), "column clues [1,1] and [1]");

  // Full and empty lines.
  check(eq(lineRuns([true, true, true]), [3]), "full line -> [3]");
  check(eq(lineRuns([false, false]), [0]), "empty line -> [0]");

  // Placements generator sanity: clue [2] in length 4, middle known empty.
  const placements = generateLinePlacements([2], 4, [0, 0, 2, 0]);
  check(placements.length === 1 && eq(placements[0], [true, true, false, false]),
    "placements respect known cells");
  check(generateLinePlacements([0], 3, [0, 0, 0]).length === 1, "clue [0] has exactly the empty placement");
}

// ------------------------------------------------- (b) ambiguous pattern
section("(b) ambiguous 2x2 checkerboard is rejected");
{
  const checker = [
    [true, false],
    [false, true],
  ];
  const { rows, cols } = deriveClues(checker);
  const cs = countSolutions(rows, cols, 2, 2);
  check(cs.count >= 2, `checkerboard has >= 2 solutions (got ${cs.count})`);
  const a = analyzePicture(checker);
  check(a.solutions !== 1, "analyzePicture does not certify the checkerboard");
}

// ------------------------------------------------------- (c) pool gate
section("(c) pool gate — all 90 pictures");
{
  check(PICTURES.length === 90, `pool has 90 pictures (got ${PICTURES.length})`);
  const ids = new Set(PICTURES.map((p) => p.id));
  check(ids.size === 90, "picture ids are unique");
  for (const size of [5, 10, 15] as const) {
    check(POOL_BY_SIZE[size].length === 30, `POOL_BY_SIZE[${size}] has 30`);
    // Flat order: tier-grouped 1,2,3 x10, ids s{size}t{tier}-{k}.
    POOL_BY_SIZE[size].forEach((p, n) => {
      const tier = Math.floor(n / 10) + 1;
      const k = n % 10;
      check(p.id === `s${size}t${tier}-${k}`, `POOL_BY_SIZE[${size}][${n}] id is s${size}t${tier}-${k} (got ${p.id})`);
      check(p.grade.tier === tier, `${p.id} grade tier matches position`);
    });
    check(pictureAt(size, 30).id === POOL_BY_SIZE[size][0].id, `pictureAt(${size}, 30) wraps to [0]`);
  }
  for (const p of PICTURES) {
    const bmp = pictureBitmap(p);
    check(bmp.length === p.size && bmp.every((r) => r.length === p.size), `${p.id} art is ${p.size}x${p.size}`);
    for (const row of p.art)
      for (const ch of row)
        check(ch === "." || ch in p.palette, `${p.id} palette covers '${ch}'`);
    const a = analyzePicture(bmp);
    check(a.solutions === 1 && !a.budgetExceeded, `${p.id} has exactly 1 solution`);
    check(a.lineSolvable, `${p.id} is line-solvable`);
    check(a.density >= 0.35 && a.density <= 0.65, `${p.id} density ${a.density.toFixed(3)} in [0.35, 0.65]`);
    check(maxRuns(bmp) <= MAX_RUNS[p.size as 5 | 10 | 15], `${p.id} max runs within limit`);
    check(Math.abs(a.density - p.grade.density) < 1e-9, `${p.id} recorded density matches`);
    check(a.solveRounds === p.grade.solveRounds, `${p.id} recorded solveRounds matches`);
    check(Math.abs(a.hardLineRatio - p.grade.hardLineRatio) < 1e-9, `${p.id} recorded hardLineRatio matches`);
    // Solver reproduces the original bitmap cell-for-cell, both ways:
    const { rows, cols } = deriveClues(bmp);
    const ls = lineSolve(rows, cols, p.size);
    const fromLines = ls.grid.map((r) => r.map((v) => v === 1));
    check(ls.solved && bitmapsEqual(fromLines, bmp), `${p.id} lineSolve solution === original bitmap`);
    const cs = countSolutions(rows, cols, p.size, 2);
    check(cs.solution !== undefined && bitmapsEqual(cs.solution, bmp), `${p.id} counted solution === original bitmap`);
  }
}

// ---------------------------------------------------------------- (d) fuzz
section("(d) fuzz — 200 random bitmaps per size, densities 0.3/0.5/0.7");
{
  // Deterministic RNG (mulberry32) so the battery is reproducible.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20261021);
  const t0 = Date.now();
  let uniques = 0;
  let checkedFuzz = 0;
  for (const size of [5, 10, 15]) {
    for (let i = 0; i < 200; i++) {
      const d = [0.3, 0.5, 0.7][i % 3];
      const bmp = Array.from({ length: size }, () =>
        Array.from({ length: size }, () => rand() < d),
      );
      const { rows, cols } = deriveClues(bmp);
      const cs = countSolutions(rows, cols, size, 2);
      checkedFuzz++;
      check(!cs.budgetExceeded, `fuzz ${size}#${i} finished within step budget`);
      if (cs.count === 1) {
        uniques++;
        // The input bitmap is a solution of its own clues; if the
        // solver claims uniqueness, its solution must be that bitmap.
        check(cs.solution !== undefined && bitmapsEqual(cs.solution, bmp),
          `fuzz ${size}#${i} unique solution equals the only candidate`);
      }
      if (cs.count >= 1) {
        // Every reported solution must actually satisfy the clues.
        const back = deriveClues(cs.solution!);
        check(eq(back.rows, rows) && eq(back.cols, cols), `fuzz ${size}#${i} solution satisfies clues`);
      }
    }
  }
  const elapsed = Date.now() - t0;
  console.log(`  fuzz: ${checkedFuzz} puzzles, ${uniques} unique, ${elapsed} ms total`);
  check(elapsed < 90000, `fuzz total ${elapsed} ms under 90 s budget`);
}

// ---------------------------------------------------------------- hints
section("hints — nextForcedCell");
{
  const p = POOL_BY_SIZE[10][0];
  const bmp = pictureBitmap(p);
  const { rows, cols } = deriveClues(bmp);
  const blank: Known[][] = Array.from({ length: 10 }, () => new Array<Known>(10).fill(0));
  const forced = nextForcedCell({ rowClues: rows, colClues: cols, size: 10, known: blank });
  check(forced !== null, "blank board of a line-solvable picture has a forced cell");
  if (forced) {
    const truth = bmp[forced.r][forced.c] ? 1 : 2;
    check(forced.value === truth, "forced cell value matches the solution");
    check(["overlap", "edge", "complete-count", "cross"].includes(forced.reason), "forced cell carries a reason kind");
  }
  const solved: Known[][] = bmp.map((r) => r.map((v) => (v ? 1 : 2) as Known));
  check(nextForcedCell({ rowClues: rows, colClues: cols, size: 10, known: solved }) === null,
    "fully known board yields no forced cell");
}

// ---------------------------------------------------------------- (e) flow
section("(e) flow — mistakes, marks, undo strokes, win, perfect");
{
  const sol = [
    [true, true, false],
    [true, false, false],
    [false, false, true],
  ];

  // Wrong fill: counts, cell reverts to unknown.
  const g1 = new NonogramGame(sol);
  const ch = g1.paint(0, 2, "fill"); // solution empty
  check(ch !== null && ch.mistake, "wrong fill reports a mistake");
  check(g1.mistakes === 1, "wrong fill increments mistakes");
  check(g1.cells[0][2] === 0, "wrong fill reverts the cell to unknown");

  // Wrong mark: never counts, mark stays.
  const g2 = new NonogramGame(sol);
  g2.paint(0, 0, "mark"); // solution filled — a wrong ✕ note
  check(g2.mistakes === 0, "wrong mark does not count as a mistake");
  check(g2.cells[0][0] === 2, "wrong mark stays as the player's note");
  // Mark toggles off again.
  g2.paint(0, 0, "mark");
  check(g2.cells[0][0] === 0, "re-marking toggles the note off");

  // Three wrong fills lose the game.
  const g3 = new NonogramGame(sol);
  g3.paint(0, 2, "fill");
  g3.paint(1, 1, "fill");
  g3.paint(1, 2, "fill");
  check(g3.mistakes === MAX_MISTAKES && g3.status === "lost", "3 wrong fills = lost");
  check(g3.paint(2, 2, "fill") === null, "no painting after the game ended");

  // Drag stroke = ONE undo unit.
  const g4 = new NonogramGame(sol);
  g4.paintStroke([{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }], "fill");
  check(g4.cells[0][0] === 1 && g4.cells[0][1] === 1 && g4.cells[1][0] === 1, "stroke painted 3 cells");
  check(g4.undoDepth === 1, "stroke recorded as a single undo unit");
  check(g4.undo() === true, "undo succeeds");
  check(g4.cells[0][0] === 0 && g4.cells[0][1] === 0 && g4.cells[1][0] === 0, "one undo reverts the whole stroke");
  check(g4.undo() === false, "undo on empty stack returns false");
  // Single paints are separate units; undo of a mistake refunds it.
  const g5 = new NonogramGame(sol);
  g5.paint(0, 2, "fill"); // mistake
  check(g5.mistakes === 1 && g5.undoDepth === 1, "single paint is its own undo unit");
  g5.undo();
  check(g5.mistakes === 0, "undoing a mistaken stroke refunds the mistake");

  // Fill toggle + erase.
  const g6 = new NonogramGame(sol);
  g6.paint(0, 0, "fill");
  check(g6.cells[0][0] === 1, "fill paints");
  g6.paint(0, 0, "fill");
  check(g6.cells[0][0] === 0, "fill on a filled cell toggles off");
  g6.paint(2, 2, "fill");
  g6.paint(2, 2, "erase");
  check(g6.cells[2][2] === 0, "erase clears a filled cell");

  // Win detection + perfect flag.
  const g7 = new NonogramGame(sol);
  g7.paintStroke([{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }], "fill");
  check(!g7.isWin() && g7.status === "playing", "partial fill is not a win");
  g7.paint(2, 2, "fill");
  check(g7.isWin() && g7.status === "won", "completing the filled set wins");
  check(g7.perfect === true, "no mistakes + no hints = perfect");

  // A hint spends the perfect flag but not a mistake; budget is 3.
  const g8 = new NonogramGame(sol);
  check(g8.useHint(0, 0, 1) === true, "hint applies");
  check(g8.hintsUsed === 1 && g8.mistakes === 0, "hint is not a mistake");
  check(g8.cells[0][0] === 1, "hint reveals the cell");
  g8.useHint();
  g8.useHint();
  check(g8.hintsUsed === MAX_HINTS, "hint budget reaches 3");
  check(g8.useHint() === false, "4th hint refused");
  g8.paintStroke([{ r: 0, c: 1 }, { r: 1, c: 0 }, { r: 2, c: 2 }], "fill");
  check(g8.status === "won" && g8.perfect === false, "won with hints is not perfect");

  // Move log encodes fills, marks, mistakes, hints and undo compactly.
  const g9 = new NonogramGame(sol);
  g9.paint(0, 0, "fill");
  g9.paint(0, 2, "mark");
  g9.paint(1, 1, "fill"); // wrong
  const log = g9.encodeLog();
  check(log.includes("f0,0") && log.includes("x0,2") && log.includes("!1,1"), `move log encodes entries (${log})`);

  // Timer hooks: pause excludes paused span.
  const g10 = new NonogramGame(sol, { now: 1000 });
  g10.pauseClock(3000);
  g10.resumeClock(5000);
  check(g10.elapsedMs(6000) === 3000, "elapsed excludes the paused span");
  check(g10.progress().total === 4 && g10.progress().correct === 0, "progress counts solution fills");
}

// ---------------------------------------------------------------- summary
console.log(`\n== SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log("ALL GREEN");
