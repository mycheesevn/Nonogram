# Nonogram Engine — Report

Deliverables in `~/workspace/nonogram-staging/engine/` (pure TypeScript, no
imports outside the folder, `tsc --strict` clean):

| File | Contents |
|---|---|
| `clues.ts` | `deriveClues`, `lineRuns` (empty line → `[0]`), `lineMatchesClue`, `maxRuns`, `bitmapsEqual` |
| `solver.ts` | `generateLinePlacements` (cached), `lineSolve`, `countSolutions` (cap + step budget), `analyzePicture`, `nextForcedCell` (reasons `overlap`/`edge`/`complete-count`/`cross`) |
| `pool-data.ts` | The 90 verified pictures (`NoPicture[]`, grades recorded) |
| `pool.ts` | `POOL`/`PICTURES`, `POOL_BY_SIZE`, `poolCell`, `getPicture`, `pictureAt`, `pictureBitmap`, `pictureClues`, `difficultyScore`, `MAX_RUNS` |
| `flow.ts` | `NonogramGame`: paint modes + toggles, drag stroke = 1 undo unit, mistakes, hints (max 3), move log, timer hooks, win/perfect |
| `test-engine.ts` | Test battery (below) |

## Interface alignment (SQL workstream) — CONFIRMED

- Every picture id is exactly ``s${size}t${tier}-${k}``, `k` = 0..9 within
  its size+tier cell.
- `POOL_BY_SIZE[size]` is a flat deterministic array of 30: tier 1's 10
  (k ascending), then tier 2's 10, then tier 3's 10. Race resolution
  `POOL_BY_SIZE[size][seed % 30]` and Daily `POOL_BY_SIZE[size][dayHash % 30]`
  work as specified (`pictureAt(size, n)` wraps n mod 30); the real tier is
  read from `picture.grade.tier`.
- The test battery asserts this ordering and id shape for all 90 pictures.

## Test output (real run)

```
cd ~/workspace/nonogram-staging/engine && npx -y tsx test-engine.ts
== (a) clue derivation            (incl. [0] lines, design's 4 1 3 example)
== (b) ambiguous 2x2 checkerboard is rejected   (countSolutions = 2)
== (c) pool gate — all 90 pictures (unique + line-solvable + density +
                                   max-runs + solver solution === original
                                   bitmap cell-for-cell, both solver tiers)
== (d) fuzz — 600 puzzles, 330 unique, 11233 ms total
== hints — nextForcedCell
== (e) flow — mistakes, marks, undo strokes, win, perfect
== SUMMARY: 13164 passed, 0 failed — ALL GREEN
```

- Fuzz: 200 seeded (mulberry32, seed 20261021) random bitmaps per size,
  cycling densities 0.3/0.5/0.7 → 600 puzzles in ~11.2 s total, worst single
  puzzle ~2.7 s, **zero step-budget hits** (budget = 20,000 DFS nodes);
  every claimed-unique solution equalled the only candidate bitmap.
- Gate (every one of the 90): `solutions === 1`, `lineSolvable`,
  density ∈ [0.35, 0.65], max runs ≤ 3 (5×5) / 4 (10×10) / 5 (15×15),
  recorded grade fields re-verified against a fresh `analyzePicture`.

## Difficulty grading

Score (documented in `pool.ts`/`pool-data.ts`):
`score = 3·solveRounds + 10·hardLineRatio + 2·density`, where
`hardLineRatio` = fraction of lines with > `HARD_LINE_PLACEMENT_THRESHOLD`
(10) initially feasible placements. Within each size, pictures were sorted
by score and split into thirds → tier 1 Dễ / 2 Trung bình / 3 Khó.

| Cell | solveRounds | hardLineRatio | density |
|---|---|---|---|
| 5×5 t1 | 2–3 | 0.00 | 0.40–0.64 |
| 5×5 t2 | 3 | 0.00 | 0.52–0.60 |
| 5×5 t3 | 3–4 | 0.00 | 0.48–0.64 |
| 10×10 t1 | 3 | 0.00–0.15 | 0.45–0.65 |
| 10×10 t2 | 3–4 | 0.05–0.40 | 0.50–0.65 |
| 10×10 t3 | 4–7 | 0.00–0.45 | 0.37–0.65 |
| 15×15 t1 | 3 | 0.20–0.40 | 0.38–0.57 |
| 15×15 t2 | 3–4 | 0.23–0.47 | 0.38–0.53 |
| 15×15 t3 | 3–5 | 0.33–0.77 | 0.35–0.49 |

Caveat: at 5×5 a line can never have >10 placements, so `hardLineRatio`
is identically 0 and tiers separate on rounds + density only — the spread
is inherently narrow at that size; the split is still the measured one.

## Pool list (id — title EN — density)

**5×5** — t1: s5t1-0 Pine tree .520 · s5t1-1 Fish .600 · s5t1-2 Mushroom .600 ·
s5t1-3 Snail .640 · s5t1-4 Snowflake .640 · s5t1-5 Anchor .400 · s5t1-6 Flower
.400 · s5t1-7 Moon .440 · s5t1-8 Umbrella .480 · s5t1-9 Butterfly .520 —
t2: s5t2-0 Snowman .520 · s5t2-1 Cherries .560 · s5t2-2 House .560 · s5t2-3 Ice
cream .560 · s5t2-4 Rocket .560 · s5t2-5 Star .560 · s5t2-6 Strawberry .560 ·
s5t2-7 Sun .560 · s5t2-8 Rain cloud .600 · s5t2-9 Grapes .600 —
t3: s5t3-0 Owl .600 · s5t3-1 Apple .640 · s5t3-2 Bee .640 · s5t3-3 Bell .640 ·
s5t3-4 Teacup .640 · s5t3-5 Heart .640 · s5t3-6 Turtle .640 · s5t3-7 Lightning
.480 · s5t3-8 Sailboat .600 · s5t3-9 Cat .640

**10×10** — t1: s10t1-0 Fish .580 · s10t1-1 House .580 · s10t1-2 Cupcake .600 ·
s10t1-3 Mushroom .640 · s10t1-4 Rocket .450 · s10t1-5 Umbrella .480 · s10t1-6
Apple .650 · s10t1-7 Ghost .580 · s10t1-8 Car .640 · s10t1-9 Snail .580 —
t2: s10t2-0 Bee .600 · s10t2-1 Frog .640 · s10t2-2 Ladybug .640 · s10t2-3
Snowman .520 · s10t2-4 Cat .640 · s10t2-5 Heart .640 · s10t2-6 Turtle .650 ·
s10t2-7 Ice cream .500 · s10t2-8 Rabbit .540 · s10t2-9 Tree .540 —
t3: s10t3-0 Moon and star .370 · s10t3-1 Flower .440 · s10t3-2 Bird .510 ·
s10t3-3 Sailboat .470 · s10t3-4 Dog .650 · s10t3-5 Butterfly .580 · s10t3-6
Owl .640 · s10t3-7 Penguin .440 · s10t3-8 Sun .600 · s10t3-9 Star .500

**15×15** — t1: s15t1-0 House .484 · s15t1-1 Dog .556 · s15t1-2 Penguin .560 ·
s15t1-3 Rabbit .480 · s15t1-4 Fish .382 · s15t1-5 Ghost .511 · s15t1-6 Whale
.382 · s15t1-7 Octopus .533 · s15t1-8 Butterfly .569 · s15t1-9 Snowman .436 —
t2: s15t2-0 Train .471 · s15t2-1 Sun .387 · s15t2-2 Turtle .462 · s15t2-3 Bee
.516 · s15t2-4 Snail .529 · s15t2-5 Heart .378 · s15t2-6 Apple .453 · s15t2-7
Hot-air balloon .453 · s15t2-8 Owl .489 · s15t2-9 Flower .382 —
t3: s15t3-0 Rainbow .480 · s15t3-1 Cat .493 · s15t3-2 Star .360 · s15t3-3 Pine
tree .364 · s15t3-4 Sailboat .369 · s15t3-5 Rocket .364 · s15t3-6 Ladybug .462 ·
s15t3-7 Lighthouse .400 · s15t3-8 Crab .431 · s15t3-9 Moon and stars .351

## Authoring notes — reworked / dropped pictures

The gate was never lowered; failing drafts were re-drawn or pixel-tweaked
until they passed.

- **5×5** — 48 drafted; 38 passed as drawn. 10 repaired with ≤2 pixel flips
  (cat, sailboat, carrot, lightning bolt, leaf, decorated egg, key, donut,
  bone, paw). 30 selected; 18 gate-passing spares unused (gem, ghost, carrot,
  candle, music note, leaf, acorn, pineapple, egg, key, sword, shield, cross,
  spade, donut, bone, paw, eye).
- **10×10** — 36 drafted; 31 passed as drawn. Crab reworked by hand
  (density 0.68 → 0.64) and the sailboat wave row redrawn (5 runs → 4);
  dog fixed with 1 flip; sun fixed by filling one body row; turtle fixed by
  shifting the head one row down. 30 selected; 6 unused (teddy, lighthouse,
  balloon, whale, crab, octopus — those subjects appear at 15×15 instead).
- **15×15** — 37 procedurally drawn (raster primitives); 26 passed as drawn.
  Under-density shapes enlarged at the source (star, rocket, pine, sun, car,
  guitar); house roof redrawn solid (outline roof was ambiguous);
  apple/whale/crab accepted 1-flip repairs after visual diff inspection;
  rocket's randomised repair was **rejected** (floating speck pixels) and
  fixed instead by enlarging fins/flame. 30 selected; 7 unused (guitar,
  bear, car, crown, castle, mushroom, teapot).

## Flow semantics worth noting for integration

- Wrong fill: `mistakes++`, cell reverts to unknown, entry logged as `!r,c`;
  3 mistakes → `status = "lost"`. Wrong ✕ mark never counts and stays.
- Undo restores the pre-stroke cell states and refunds mistakes made in
  that stroke (one drag stroke = one undo unit, including explicit
  `beginStroke`/`endStroke` or the `paintStroke` helper).
- `perfect` = 0 mistakes && 0 hints (badge condition); `useHint` refuses
  beyond 3 and can apply a solver-revealed cell.
- Move log encoding: `f` fill, `x` mark, `e` erase/toggle-off, `!` mistake,
  `h…=f|x` hint, `u` undo — semicolon-joined via `encodeLog()`.
- Timer is caller-driven (`startClock`/`pauseClock`/`resumeClock`/
  `elapsedMs(now)`/`finishClock(now)`), so the engine stays deterministic
  and DOM-free.
