/** verify-lessons.ts — machine verification of the Bí Kíp drills.
 *
 *  Run: npx tsx scripts/verify-lessons.ts   (from ~/workspace/nonogram)
 *
 *  For every lesson in lib/nonogram/lessons.ts:
 *  - the drill's pre-known cells agree with the pool picture's bitmap
 *    ('#' only on filled cells, 'x' only on empty cells), the target
 *    starts unknown, and the taught action matches the true bitmap;
 *  - the picture's clue set has exactly one solution;
 *  - lessons 1–5: solver.nextForcedCell(drill known grid) returns
 *    exactly the target cell with the taught value. Lessons 1–3 also
 *    assert the solver's reason ('complete-count' / 'overlap' /
 *    'edge'). Lesson 5 (cross) additionally asserts the cross
 *    property directly: the target's row placements disagree on the
 *    target (row alone cannot decide it) while its column placements
 *    unanimously give the taught value (the column decides it);
 *  - lesson 6 (elimination): placement analysis on the target row —
 *    at least one placement survives, none fills the target, and
 *    assuming the target filled leaves zero placements (a controlled
 *    contradiction).
 */
import {
  LESSONS,
  drillClues,
  drillKnownGrid,
  drillPicture,
  drillSolution,
} from "../lib/nonogram/lessons";
import {
  countSolutions,
  generateLinePlacements,
  nextForcedCell,
  type Known,
} from "../lib/nonogram/solver";

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const EXPECTED_REASON: Record<string, string> = {
  "no-lesson-extremes": "complete-count",
  "no-lesson-overlap": "overlap",
  "no-lesson-edge": "edge",
};

for (const lesson of LESSONS) {
  console.log(`\n${lesson.id} (${lesson.drill.pictureId})`);
  const pic = drillPicture(lesson);
  const size = pic.size;
  const bitmap = drillSolution(lesson);
  const { rows, cols } = drillClues(lesson);
  const known = drillKnownGrid(lesson);
  const { target, action } = lesson.drill;
  const wantValue: 1 | 2 = action === "fill" ? 1 : 2;

  // Shape + consistency of the pre-known grid with the true bitmap.
  check(known.length === size && known.every((r) => r.length === size), "known grid shape matches picture size");
  let consistent = true;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (known[r][c] === 1 && !bitmap[r][c]) consistent = false;
      if (known[r][c] === 2 && bitmap[r][c]) consistent = false;
    }
  }
  check(consistent, "pre-known cells agree with the pool bitmap");
  check(known[target.r][target.c] === 0, "target cell starts unknown");
  check(bitmap[target.r][target.c] === (action === "fill"), `taught action '${action}' matches the true bitmap`);

  const cs = countSolutions(rows, cols, size, 2);
  check(cs.count === 1 && !cs.budgetExceeded, "clue set has exactly one solution", `count=${cs.count}`);

  if (lesson.id === "no-lesson-eliminate") {
    // Lesson 6: verified by placement analysis (documented in lessons.ts).
    const rowKnown = known[target.r];
    const placements = generateLinePlacements(rows[target.r], size, rowKnown);
    check(placements.length > 0, "target row still has valid placements", `${placements.length} placements`);
    check(
      placements.every((pl) => !pl[target.c]),
      "no placement of the row clue fills the target (elimination)",
    );
    const assumed = rowKnown.slice() as Known[];
    assumed[target.c] = 1;
    check(
      generateLinePlacements(rows[target.r], size, assumed).length === 0,
      "assuming the target filled yields zero placements (controlled contradiction)",
    );
    continue;
  }

  const f = nextForcedCell({ rowClues: rows, colClues: cols, size, known });
  check(
    !!f && f.r === target.r && f.c === target.c && f.value === wantValue,
    "nextForcedCell returns the target with the taught value",
    f ? `got (${f.r},${f.c})=${f.value} reason=${f.reason}` : "got null",
  );
  const expectedReason = EXPECTED_REASON[lesson.id];
  if (expectedReason) {
    check(!!f && f.reason === expectedReason, `solver reason is '${expectedReason}'`, f ? `got '${f.reason}'` : "got null");
  }

  if (lesson.id === "no-lesson-cross") {
    // Cross property: the row alone cannot decide the target…
    const rowPlacements = generateLinePlacements(rows[target.r], size, known[target.r]);
    const rowFills = new Set(rowPlacements.map((pl) => pl[target.c]));
    check(rowPlacements.length > 0 && rowFills.size === 2, "target's row alone leaves the cell ambiguous");
    // …but the crossing column alone decides it.
    const colKnown: Known[] = known.map((row) => row[target.c]);
    const colPlacements = generateLinePlacements(cols[target.c], size, colKnown);
    check(
      colPlacements.length > 0 &&
        colPlacements.every((pl) => (pl[target.r] ? 1 : 2) === wantValue),
      "target's column alone decides the cell (cross inference)",
      `${colPlacements.length} column placements`,
    );
  }
}

console.log(failures === 0 ? "\nALL LESSON DRILLS VERIFIED ✓" : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
