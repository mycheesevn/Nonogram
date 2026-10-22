/** Bí Kíp — Nonogram technique lessons.
 *
 *  Every drill is a real position from the verified picture pool
 *  (lib/nonogram/pool.ts): `known` cells are copied from the pool
 *  picture's own bitmap ('#' = filled, 'x' = marked empty,
 *  '.' = still unknown), and the target cell is machine-verified by
 *  scripts/verify-lessons.ts:
 *  - Lessons 1–5: `solver.nextForcedCell` on the drill's known grid
 *    returns exactly the target cell with the taught value (lesson 5
 *    additionally asserts the cross property: the target's row alone
 *    leaves the cell ambiguous, its column alone decides it — the
 *    solver's reason taxonomy labels that by the forcing line's
 *    shape, so the cross property is asserted separately).
 *  - Lesson 6: placement analysis on the target row — no placement
 *    of the row's clue fills the target, and assuming it filled
 *    leaves zero placements (a controlled contradiction).
 *
 *  Lesson text lives here (bilingual fields), not in i18n.
 *  Progress ids are prefixed `no-` (shared library_progress table).
 */
import { getPicture, pictureBitmap, pictureClues, type NoPicture } from "./pool";
import type { CellState } from "./flow";
import type { KnownGrid } from "./solver";

export interface NoDrill {
  /** Pool picture the position is taken from. */
  pictureId: string;
  /** Pre-known cells, one string per row: '#' filled, 'x' marked, '.' unknown. */
  known: string[];
  /** The cell the learner must paint. */
  target: { r: number; c: number };
  /** Correct paint mode for the target: fill it or mark it empty. */
  action: "fill" | "mark";
}

export interface NoLesson {
  /** library_progress key (prefix `no-`). */
  id: string;
  icon: string;
  title: { vi: string; en: string };
  /** 2–4 short paragraphs, separated by "\n\n". */
  body: { vi: string; en: string };
  /** One-line instruction shown above the drill board. */
  prompt: { vi: string; en: string };
  /** Why the taught technique forces the target, shown on success. */
  explain: { vi: string; en: string };
  drill: NoDrill;
}

export const LESSONS: NoLesson[] = [
  {
    id: "no-lesson-extremes",
    icon: "📐",
    title: { vi: "Đọc gợi ý & cực trị", en: "Reading clues & extremes" },
    body: {
      vi: "Các số bên trái mỗi hàng (và phía trên mỗi cột) cho biết độ dài các đoạn ô tô liên tiếp trong hàng đó, theo đúng thứ tự. Giữa hai đoạn luôn có ít nhất một ô trống.\n\nTrường hợp dễ nhất — và nên tìm trước tiên: khi tổng các đoạn cộng với số ô trống tối thiểu giữa chúng (số đoạn trừ đi 1) vừa bằng đúng độ dài của hàng. Khi đó hàng không còn chút \"độ rơ\" nào: vị trí của mọi đoạn đều bị khóa cứng và ta điền được ngay cả hàng.\n\nHãy quét các hàng và cột \"vừa khít\" như vậy trước khi suy luận sâu hơn — chúng cho thông tin miễn phí và thu hẹp mọi hàng, cột giao nhau.",
      en: "The numbers beside each row (and above each column) give the lengths of the consecutive filled runs in that line, in order. Between two runs there is always at least one empty cell.\n\nThe easiest case — and the one to look for first: when the runs plus the minimum gaps between them (number of runs minus 1) add up to exactly the length of the line. The line then has zero slack: every run's position is locked and the whole line can be filled in at once.\n\nScan for such exactly-fitting lines before reasoning any deeper — they give free information and narrow down every crossing line.",
    },
    prompt: {
      vi: "Hàng 2 có gợi ý 3–1 trên bàn 5 ô: 3 + 1 ô trống bắt buộc + 1 = 5, vừa khít. Hãy tô ô khoanh vàng — ô đầu tiên của hàng.",
      en: "Row 2 has the clue 3–1 on a 5-wide board: 3 + 1 mandatory gap + 1 = 5, an exact fit. Fill the highlighted cell — the first cell of the row.",
    },
    explain: {
      vi: "Đúng vậy! Vì 3 + 1 + 1 = 5 nên đoạn 3 buộc phải bắt đầu ngay ở ô đầu tiên, đoạn 1 nằm ở ô cuối cùng, và ô giữa hai đoạn là ô trống. Cả hàng đã được xác định hoàn toàn chỉ từ phép cộng — đó là sức mạnh của cực trị \"vừa khít\".",
      en: "Exactly! Because 3 + 1 + 1 = 5, the run of 3 must start at the very first cell, the run of 1 sits in the last cell, and the cell between them is empty. The whole row was determined by one addition — that is the power of the exact-fit extreme.",
    },
    drill: {
      pictureId: "s5t1-1", // Cá / Fish — row 2 (index 1) clue [3, 1]
      known: ["x#xxx", ".....", ".....", ".....", "....."],
      target: { r: 1, c: 0 },
      action: "fill",
    },
  },
  {
    id: "no-lesson-overlap",
    icon: "↔️",
    title: { vi: "Chồng lấp hai đầu", en: "Overlap from both ends" },
    body: {
      vi: "Khi một đoạn dài hơn \"độ rơ\" của hàng, hãy thử đặt nó ở hai vị trí cực đoan: sát trái nhất có thể và sát phải nhất có thể. Phần giao nhau của hai cách đặt đó — vùng chồng lấp — chắc chắn thuộc về đoạn, dù đoạn thực sự nằm ở đâu.\n\nĐoạn càng dài, vùng chồng lấp càng rộng. Kỹ thuật này áp dụng cho từng đoạn riêng lẻ, kể cả đoạn nằm giữa khi hai bên còn có các đoạn khác.\n\nĐây là kỹ thuật mở khóa hầu hết các ô đầu tiên của một ván — hãy thử nó với mọi đoạn dài trước khi chuyển sang các suy luận phức tạp hơn.",
      en: "When a run is longer than the line's slack, try placing it at the two extremes: as far left as possible and as far right as possible. The intersection of those two placements — the overlap — certainly belongs to the run, wherever the run really sits.\n\nThe longer the run, the wider the overlap. This works for each run on its own, even a middle run with other runs on both sides.\n\nOverlap unlocks most of the first cells in a game — try it on every long run before moving to more complex reasoning.",
    },
    prompt: {
      vi: "Hàng 5 có gợi ý 1–4–1. Đoạn 4 ở giữa: đặt sát trái nhất nó chiếm các cột 3–6, đặt sát phải nhất nó chiếm các cột 5–8. Phần giao là cột 5 và 6 — hãy tô ô khoanh vàng (cột 5).",
      en: "Row 5 has the clue 1–4–1. The middle run of 4: placed farthest left it covers columns 3–6, farthest right it covers columns 5–8. The overlap is columns 5 and 6 — fill the highlighted cell (column 5).",
    },
    explain: {
      vi: "Chính xác! Đoạn 4 chỉ có thể bắt đầu ở cột 3, 4 hoặc 5 (sau đoạn 1 và ô trống bắt buộc), và cả ba cách đặt đều phủ qua cột 5. Nên ô này chắc chắn được tô — dù ta chưa biết vị trí chính xác của đoạn.",
      en: "Correct! The run of 4 can only start at column 3, 4 or 5 (after the run of 1 and its mandatory gap), and all three placements cover column 5. So this cell is certainly filled — even though we don't yet know exactly where the run sits.",
    },
    drill: {
      pictureId: "s10t3-4", // Dog — row 5 (index 4) clue [1, 4, 1]
      known: [
        "x#######xx",
        "x########x",
        "x########x",
        "##xx##xx##",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
      ],
      target: { r: 4, c: 4 },
      action: "fill",
    },
  },
  {
    id: "no-lesson-edge",
    icon: "🧲",
    title: { vi: "Khóa biên", en: "Edge locking" },
    body: {
      vi: "Một dấu ✕ cũng là thông tin quý giá: không đoạn tô nào được phủ qua ô ✕. Nếu một dấu ✕ nằm gần biên, nó \"khóa\" đoạn đầu tiên (hoặc cuối cùng) vào khoảng trống còn lại — và phần chồng lấp trong khoảng bị thu hẹp đó cho ra những ô chắc chắn.\n\nHãy luôn hỏi: đoạn này bị chặn bởi biên bàn cờ hay bởi ô ✕ nào? Khoảng chạy khả thi càng ngắn thì càng nhiều ô bị khóa.\n\nKhóa biên đặc biệt mạnh ở đầu ván, khi các dấu ✕ ở rìa hàng và cột dần ép các đoạn dài vào đúng vị trí của chúng.",
      en: "A ✕ mark is valuable information too: no filled run may cover a ✕ cell. If a ✕ sits near an edge, it locks the first (or last) run into the remaining space — and the overlap inside that shrunken space yields certain cells.\n\nAlways ask: what bounds this run — the board edge or a ✕? The shorter the feasible span, the more cells are locked.\n\nEdge locking is especially strong early in a game, when ✕ marks near the ends of rows and columns squeeze long runs into place.",
    },
    prompt: {
      vi: "Hàng 2 có gợi ý 4 và một dấu ✕ ở cột 8. Đoạn 4 không thể chạm vào ô ✕ nên chỉ có thể bắt đầu ở cột 1, 2, 3 hoặc 4 — mọi cách đặt đều phủ qua cột 4. Hãy tô ô khoanh vàng.",
      en: "Row 2 has the clue 4 and a ✕ mark at column 8. The run of 4 cannot touch the ✕, so it can only start at column 1, 2, 3 or 4 — and every placement covers column 4. Fill the highlighted cell.",
    },
    explain: {
      vi: "Đúng! Dấu ✕ ở cột 8 chặn đoạn 4 lại trong 7 ô đầu tiên của hàng. Bốn vị trí bắt đầu khả thi (cột 1–4) đều phủ qua cột 4, nên ô đó chắc chắn thuộc về đoạn — đó chính là khóa biên bằng ô ✕.",
      en: "Right! The ✕ at column 8 confines the run of 4 to the first 7 cells of the row. All four feasible starts (columns 1–4) cover column 4, so that cell certainly belongs to the run — that is edge locking with a ✕.",
    },
    drill: {
      pictureId: "s10t1-0", // Fish — row 2 (index 1) clue [4], ✕ at column 8
      known: [
        "xxxx##xxxx",
        ".......x..",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
      ],
      target: { r: 1, c: 3 },
      action: "fill",
    },
  },
  {
    id: "no-lesson-count",
    icon: "🔢",
    title: { vi: "Đếm hoàn tất", en: "Completion counting" },
    body: {
      vi: "Đếm là kỹ thuật đơn giản mà hiệu quả nhất: cộng các số gợi ý của một hàng để biết hàng đó có tổng cộng bao nhiêu ô tô. Khi số ô đã tô trong hàng bằng đúng tổng đó, mọi ô còn lại chắc chắn là ô trống — hãy đánh dấu ✕ hết.\n\nĐừng ngại đánh dấu ✕: mỗi dấu ✕ chắc chắn sẽ thu hẹp đáng kể các cột giao nhau, và nhiều ô khó sẽ lộ diện ngay sau đó.\n\nMẹo đếm cũng chạy theo chiều ngược lại: nếu các ô chưa biết của một hàng vừa đủ cho phần gợi ý còn thiếu, tất cả chúng đều phải được tô.",
      en: "Counting is the simplest and most effective technique: add up a line's clue numbers to learn how many filled cells that line contains in total. When the cells already filled in the line equal that total, every remaining cell is certainly empty — mark them all ✕.\n\nDon't hesitate to mark ✕: every certain ✕ narrows the crossing columns a lot, and many hard cells reveal themselves right afterwards.\n\nCounting also runs in reverse: if a line's unknown cells exactly match the clue amount still missing, all of them must be filled.",
    },
    prompt: {
      vi: "Hàng 5 có gợi ý 2–4–2, tổng cần 8 ô tô — và cả 8 ô tô đã hiện diện. Ô khoanh vàng (cột 3) nằm giữa hai đoạn, không thể được tô nữa. Hãy đánh dấu ✕ ô đó.",
      en: "Row 5 has the clue 2–4–2, needing 8 filled cells in total — and all 8 are already present. The highlighted cell (column 3) sits between two runs and cannot be filled any more. Mark it ✕.",
    },
    explain: {
      vi: "Chính xác! Hàng đã đủ 2 + 4 + 2 = 8 ô tô theo gợi ý, nên mọi ô chưa tô trong hàng đều phải là ô trống. Đánh dấu ✕ ở đây giúp cả hai cột liên quan thu hẹp vị trí các đoạn của chúng.",
      en: "Exactly! The row already has its full 2 + 4 + 2 = 8 filled cells, so every not-yet-filled cell in the row must be empty. Marking this ✕ helps both crossing columns narrow down their own runs.",
    },
    drill: {
      pictureId: "s10t1-3", // Mushroom — row 5 (index 4) clue [2, 4, 2], all fills known
      known: [
        "xxx####xxx",
        "xx######xx",
        "x########x",
        "##########",
        "##.####.##",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
      ],
      target: { r: 4, c: 2 },
      action: "mark",
    },
  },
  {
    id: "no-lesson-cross",
    icon: "🔀",
    title: { vi: "Suy từ ô giao", en: "Cross inference" },
    body: {
      vi: "Mỗi ô thuộc về cả một hàng và một cột. Khi hàng của nó chưa quyết định được, hãy nhìn sang cột của nó — và ngược lại. Nonogram được giải đúng theo cách đó: thông tin chạy qua lại giữa hàng và cột cho đến khi bức tranh hiện ra.\n\nThói quen tốt: mỗi khi tô hoặc đánh dấu một ô, hãy kiểm tra ngay cả hàng lẫn cột của ô đó. Một thay đổi nhỏ ở một chiều thường mở khóa ô giao tiếp theo ở chiều kia.\n\nĐừng cố \"giải\" từng hàng một cách độc lập — đáp án luôn nằm ở các ô giao nhau.",
      en: "Every cell belongs to both a row and a column. When its row cannot decide it, look at its column — and vice versa. That is how a nonogram is solved: information flows back and forth between rows and columns until the picture appears.\n\nA good habit: whenever you fill or mark a cell, immediately check both its row and its column. A small change in one direction often unlocks the next crossing cell in the other.\n\nDon't try to solve each row in isolation — the answers always live at the crossings.",
    },
    prompt: {
      vi: "Ô khoanh vàng ở hàng 7, cột 1. Hàng 7 (gợi ý 2) chưa quyết định được ô này: đoạn 2 có thể bắt đầu ở cột 1, 2 hoặc 5. Nhưng cột 1 cũng có gợi ý 2, và đoạn 2 duy nhất của cột đã nằm trọn ở hàng 4–5. Hãy đánh dấu ✕ ô khoanh vàng.",
      en: "The highlighted cell is at row 7, column 1. Its row (clue 2) cannot decide it: the run of 2 could start at column 1, 2 or 5. But column 1 also has the clue 2, and the column's only run of 2 already sits complete at rows 4–5. Mark the highlighted cell ✕.",
    },
    explain: {
      vi: "Đúng vậy! Cột 1 chỉ có một đoạn 2, và đoạn đó đã hoàn thành ở hàng 4–5. Mọi ô còn lại của cột — kể cả ô khoanh — đều là ô trống. Khi một chiều bế tắc, ô giao với chiều kia thường chính là lối thoát.",
      en: "That's it! Column 1 has just one run of 2, and that run is already complete at rows 4–5. Every other cell of the column — including the highlighted one — is empty. When one direction stalls, the crossing with the other direction is usually the way out.",
    },
    drill: {
      pictureId: "s10t1-5", // Umbrella — target row 7 / column 1 (index 6, 0)
      known: [
        "xxx####xxx",
        "xx######xx",
        "x########x",
        "##########",
        "##x####x##",
        "xxxx##xxxx",
        "...x..xxxx",
        "..........",
        "..........",
        "..........",
      ],
      target: { r: 6, c: 0 },
      action: "mark",
    },
  },
  {
    id: "no-lesson-eliminate",
    icon: "🧪",
    title: { vi: "Loại trừ & giả định có kiểm soát", en: "Elimination & controlled assumption" },
    body: {
      vi: "Khi không ô nào bị ép trực tiếp, hãy chuyển sang loại trừ: một ô chỉ được tô nếu tồn tại ít nhất một cách đặt đoạn hợp lệ phủ qua nó. Nếu mọi cách đặt đều tránh ô đó, ô đó là ô trống — đánh dấu ✕.\n\nPhiên bản mạnh hơn là giả định có kiểm soát: thử giả sử ô đó ĐƯỢC tô, rồi kiểm tra xem có mâu thuẫn không — đoạn bị ép phải phủ qua một ô ✕, hoặc một hàng/cột bị vượt quá gợi ý. Nếu mâu thuẫn, giả định sai và ta kết luận chắc chắn ô đó trống.\n\nLưu ý: giả định chỉ dùng để kiểm chứng một ô tại một thời điểm, không bao giờ để \"đoán mò\" cả đáp án — đó là ranh giới giữa suy luận và may rủi.",
      en: "When no cell is forced directly, switch to elimination: a cell may be filled only if at least one valid run placement covers it. If every placement avoids the cell, the cell is empty — mark it ✕.\n\nThe stronger version is the controlled assumption: suppose the cell WERE filled, then check for a contradiction — a run forced across a ✕, or a line exceeding its clue. If it contradicts, the assumption is wrong and the cell is certainly empty.\n\nNote: an assumption is only ever used to test one cell at a time, never to guess the answer — that is the line between reasoning and luck.",
    },
    prompt: {
      vi: "Hàng 5 có gợi ý 2–2 và hai dấu ✕ ở cột 3 và cột 5. Ô khoanh vàng (cột 4) nằm một mình giữa hai dấu ✕: đoạn ngắn nhất cũng dài 2 ô, mà tô ô này buộc đoạn phải tràn sang một ô ✕ kề bên. Hãy đánh dấu ✕ ô đó.",
      en: "Row 5 has the clue 2–2 and two ✕ marks at columns 3 and 5. The highlighted cell (column 4) sits alone between the two ✕ marks: the shortest run is 2 cells long, and filling this cell would force its run to spill onto a neighbouring ✕. Mark it ✕.",
    },
    explain: {
      vi: "Chính xác! Giả sử ô cột 4 được tô: đoạn chứa nó dài ít nhất 2 nên phải phủ thêm cột 3 hoặc cột 5 — cả hai đều đã là ✕, mâu thuẫn. Không cách đặt nào của gợi ý 2–2 phủ được ô này, nên nó bị loại trừ chắc chắn.",
      en: "Correct! Suppose the column-4 cell were filled: its run is at least 2 long, so it would also have to cover column 3 or column 5 — both already ✕, a contradiction. No placement of the 2–2 clue can cover this cell, so it is eliminated with certainty.",
    },
    drill: {
      pictureId: "s10t2-0", // Bee — row 5 (index 4) clue [2, 2], ✕ at columns 3 and 5
      known: [
        "x#xxxxxx#x",
        "xx######xx",
        "x########x",
        "##########",
        "..x.x.....",
        "..........",
        "..........",
        "..........",
        "..........",
        "..........",
      ],
      target: { r: 4, c: 3 },
      action: "mark",
    },
  },
];

// ---------------------------------------------------------------------------
// Drill helpers (shared by LibraryView and scripts/verify-lessons.ts)
// ---------------------------------------------------------------------------

/** The pool picture a lesson's drill is taken from. */
export function drillPicture(lesson: NoLesson): NoPicture {
  const p = getPicture(lesson.drill.pictureId);
  if (!p) throw new Error(`Lesson ${lesson.id}: unknown picture ${lesson.drill.pictureId}`);
  return p;
}

/** The drill picture's solution bitmap. */
export function drillSolution(lesson: NoLesson): boolean[][] {
  return pictureBitmap(drillPicture(lesson));
}

/** Row/column clues of the drill picture. */
export function drillClues(lesson: NoLesson): { rows: number[][]; cols: number[][] } {
  return pictureClues(drillPicture(lesson));
}

/** Parse a drill's `known` strings into a solver known grid. */
export function drillKnownGrid(lesson: NoLesson): KnownGrid {
  return lesson.drill.known.map((row) =>
    [...row].map((ch) => (ch === "#" ? 1 : ch === "x" ? 2 : 0) as 0 | 1 | 2),
  );
}

/** Parse a drill's `known` strings into board cell states. */
export function drillCells(lesson: NoLesson): CellState[][] {
  return drillKnownGrid(lesson) as CellState[][];
}
