# Thiết kế game Nonogram (Picross) — SynerWorlds

> Tài liệu nghiên cứu + thiết kế, lập ngày 2026-10-21. Trạng thái: **bản thiết kế chờ anh duyệt** — chưa viết code, chưa tạo migration.
> Mọi điểm đánh dấu **⚖️ ĐIỂM CẦN CHỐT** là nơi có nhiều biến thể; em đã ghi kèm khuyến nghị, anh là người quyết như các game trước.
> Anh đã cung cấp sẵn: repo GitHub `mycheesevn/Nonogram`, project Vercel `nonogram` (khởi công khi anh duyệt thiết kế, theo đúng nhịp Cờ Úp).

---

## 1. Tổng quan

**Nonogram** (tên gọi khác: Picross, Griddlers, Hanjie, Pic-a-Pix) là trò giải đố logic bằng tranh điểm ảnh: một lưới ô vuông, mỗi hàng và mỗi cột có một dãy số gợi ý cho biết độ dài các **cụm ô tô liên tiếp** trong hàng/cột đó. Người chơi suy luận để tô đúng các ô, và phần thưởng ở cuối ván là **bức tranh pixel hiện ra** — khoảnh khắc "khoe" tự nhiên nhất trong mọi thể loại puzzle.

Vì sao game này hợp làm thành viên thứ 15 của gia đình:

- **Cùng họ puzzle logic với Sudoku / Word Search / Cross Words** — ba game đã chứng minh khuôn mẫu: chơi solo tính XP, đua phòng (race) tính Elo, câu đố hằng ngày, Bí Kíp. Nonogram lấp đúng ô còn trống trong họ này: Sudoku = số, Word Search = chữ, Nonogram = hình.
- **Không có thông tin ẩn, không cần AI đối thủ, không cần server kiểm chứng từng nước** — đây là game "nhẹ kiến trúc" nhất kể từ Sudoku: đáp án nằm ở client như Sudoku race vẫn làm, server chỉ ghi kết quả qua RPC như gia đình.
- **Nội dung là tranh pixel tự sản xuất được** — kho tranh do mình tự vẽ + solver kiểm chứng tự động (mục 3), không phụ thuộc nguồn ngoài, không vấn đề bản quyền tranh.
- **Một lưu ý pháp lý nhỏ**: "Picross" là nhãn hiệu của Nintendo/Jupiter — tên hiển thị dùng thuật ngữ chung **Nonogram** (như Sudoku dùng tên chung), "Picross" chỉ nhắc trong nội dung blog/SEO dạng mô tả nếu cần.

Đối tượng: người chơi Sudoku/Word Search sẵn có của hub (cùng một khẩu vị logic), cộng thêm tệp người chơi casual thích tranh pixel trên mobile (Nonogram.com của Easybrain là một trong các app puzzle tải nhiều nhất thế giới — nhu cầu có thật và lớn).

Định vị giữ nguyên của gia đình: **trí tuệ, miễn phí, không cờ bạc, không quảng cáo**.

## 2. Luật chơi đã nghiên cứu (kèm nguồn)

### 2.1 Luật chuẩn

| Hạng mục | Luật |
|---|---|
| Bàn | Lưới N×N ô vuông (kích thước ở mục 4). Mỗi ô có 3 trạng thái: chưa biết / **tô** / **đánh dấu trống (✕)** |
| Gợi ý (clue) | Mỗi hàng và mỗi cột mang một dãy số: độ dài của từng cụm ô tô liên tiếp, **theo đúng thứ tự xuất hiện**; giữa hai cụm bất kỳ luôn có **ít nhất 1 ô trống**. Hàng/cột không có ô tô nào ghi số **0** |
| Cách chơi | Tô các ô tin chắc là có tranh; đánh dấu ✕ các ô tin chắc là trống. Đánh dấu ✕ là ghi chép phụ trợ — không bắt buộc để thắng, nhưng gần như không thể giải bài lớn nếu thiếu |
| Thắng | Toàn bộ lưới khớp **chính xác** với bức tranh ẩn: mọi ô tô đúng vị trí, mọi ô còn lại trống. (Về mặt kiểm tra: tập ô tô của người chơi = tập ô tô của tranh) |
| Tính duy nhất | Một bài Nonogram "đạt chuẩn" phải có **đúng một đáp án** và giải được bằng suy luận — đây là chuẩn chất lượng báo giấy lẫn mọi bản Picross của Nintendo; engine của mình phải *chứng minh* được điều này cho từng bài phục vụ người chơi (mục 3) |

Ví dụ gợi ý `4 1 3` trong hàng 10 ô nghĩa là: một cụm 4 ô tô, ít nhất 1 ô trống, một cụm 1 ô, ít nhất 1 ô trống, một cụm 3 ô — theo đúng thứ tự đó.

### 2.2 Các biến thể xử lý lỗi sai — nghiên cứu đối chiếu

Đây là điểm luật phân hóa nhất giữa các bản Nonogram/Picross, nên em đối chiếu đủ cả bốn dòng:

| Bản | Xử lý khi tô sai | Ghi chú |
|---|---|---|
| **Mario's Picross / Mario's Super Picross** (Nintendo, 1995) | **Phạt thời gian leo thang 2 → 4 → 8 phút** cho các lần sai liên tiếp; ván có đồng hồ đếm ngược 30 phút, hết giờ = thua. Giải xong trong giờ mới được xem tranh **màu**, quá giờ tranh chỉ đen trắng | Dòng "phạt giờ" cổ điển: lỗi sai không bị chặn, nhưng trả giá bằng thời gian |
| **Picross S** (Jupiter, Switch, 2017) | **Bỏ phạt hoàn toàn** ở chế độ thường; tùy chọn bật "hỗ trợ" (tự sửa ô sai / báo hàng-cột giải được — Navigation, Hint Roulette) | Bị nhiều người chơi kỳ cựu chê: không phạt → đoán mò vô tội vạ, phá tính logic (nguồn: Metacritic user reviews; TV Tropes ghi nhận S "thiếu hẳn chế độ mà lỗi sai phải trả giá") |
| **Nonogram.com** (Easybrain, mobile) | Tô sai **mất một "mạng" (lives)** — hết mạng là thua ván; có hint và Daily Challenge | Chuẩn mobile casual hiện hành: giới hạn lỗi, báo lỗi ngay |
| **Sudoku của gia đình mình** (tiền lệ nội bộ) | **Giới hạn 3 lỗi, báo lỗi ngay khi đặt** ("check as you go"), 3 lỗi = thua, lưu ván với lý do thua rõ ràng | Đây là tiền lệ gần nhất và đã vận hành tốt trên chính tập người chơi của mình |

**Khuyến nghị (⚖️ ĐIỂM CHỐT 2): theo đúng tiền lệ Sudoku của gia đình** — giới hạn **3 lỗi**, báo lỗi **ngay khi tô**:

- Chỉ **tô sai** mới tính lỗi (tô vào ô mà tranh để trống). **Đánh dấu ✕ sai không tính lỗi** — ✕ là ghi chép cá nhân, và mọi bản Picross đều chỉ phạt hành động tô/đục ô.
- Ô tô sai **nhấp nháy đỏ + rung, tính 1 lỗi, và bị gỡ về trạng thái chưa biết** (không để ô sai nằm lại trên bàn như Sudoku để con số, vì một ô tô sai nằm lại sẽ phá toàn bộ bản đồ suy luận của người chơi — khác bản chất của Sudoku).
- Đủ 3 lỗi = ván thua, ghi kết quả `loss` qua RPC như Sudoku (XP thua = 5).
- Lý do không chọn phạt giờ kiểu Mario: đồng hồ gia đình là đếm xuôi để tính thành tích/thành tích cá nhân (mục 5), không phải đếm ngược sinh tử; phạt giờ mâu thuẫn với đua phòng (đã có xếp hạng theo thời gian hoàn thành). Lý do không chọn "không phạt" kiểu Picross S: nó khuyến khích đoán mò — trái triết lý "puzzle phải giải bằng logic" mà solver của mình (mục 3) tốn công bảo chứng.

### 2.3 Nguồn tham khảo luật & UX

- Nonogram.com / Nonogram Color (Easybrain) — mô tả trên store: luật cụm số, ✕ cho ô trống, "If you make a mistake, you have extra lives", hint, Daily Challenges: https://www.similarweb.com/de/app/google/com.easybrain.nonogram/vs/com.easybrain.nonogram.color/brazil/ (trang so sánh có trích nguyên văn mô tả store của cả hai app)
- Metacritic — Picross S user reviews (phàn nàn về việc bỏ phạt thời gian 2/4/8 phút của các bản trước): https://www.metacritic.com/game/picross-s/user-reviews/?platform=nintendo-switch
- TV Tropes — Picross (Navigation + Hint Roulette của dòng S; Mario's Picross tối đa 15×15, Picross 2 lên 30×30): https://tvtropes.org/pmwiki/pmwiki.php/YMMV/Picross
- Mario's Super Picross — cơ chế phạt 2/4/8 phút, hết giờ thua: https://vectree.io/pdf/c/marios-super-picross và bản FAQ chiến thuật: https://www.musee-des-jeux-video.com/fr/faqs/Super%20NES/1427-Mario-no-Super-Picross.pdf
- Picross DS (Time Extension): có **đua online với bạn bè** và Daily Picross gồm chế độ Nonstop Time Attack (giải liên tiếp bài nhỏ tính giờ) — tiền lệ trực tiếp cho phòng đua và Puzzle Rush ở mục 6: https://www.timeextension.com/games/ds/picross_ds
- Nonogram Ultra support — thang kích thước thị trường đang dùng (5×5, 5×10, 10×10, 10×15) và khái niệm Perfect Solve (0 lỗi, không hint): https://www.us.nz/nonogramultrasupport.html

## 3. Engine: sinh đề, solver và bảo chứng duy nhất (phần lõi)

### 3.1 Nguyên tắc: tranh trước (picture-first), không sinh ngẫu nhiên

Khác Sudoku (sinh bằng đào ô từ lưới đầy), Nonogram **bắt đầu từ bức tranh**:

1. **Kho tranh pixel được vẽ sẵn** (người vẽ tay bằng công cụ nội bộ ở giai đoạn nội dung, hoặc chuyển từ sprite pixel-art tự vẽ) — mỗi tranh là một lưới ký tự (định dạng ở 3.4) kèm bảng màu cho màn hình hiện tranh cuối ván.
2. **Clue được suy ra** từ tranh bằng phép chiếu hiển nhiên (đếm cụm theo từng hàng/cột) — không có bước "thiết kế clue" riêng.
3. Mọi tranh trước khi vào kho phục vụ đều phải qua **cổng kiểm chứng của solver** (3.3). Tranh không đạt → loại hoặc sửa tay; không có ngoại lệ, kể cả tranh cho Daily.

**Vì sao không sinh ngẫu nhiên (random fill)?** Hai lý do có bằng chứng: (a) lưới tô ngẫu nhiên hầu như không bao giờ đọc ra thành một hình nhận biết được — mà "bức tranh hiện ra" chính là phần thưởng cốt lõi của thể loại, mất nó là mất game; (b) tính duy nhất/suy luận được sụt rất nhanh theo mật độ ngẫu nhiên — tài liệu solver của dự án mã nguồn mở *vita* ghi rõ bài Nonogram tổng quát là NP-khó và các bài ngẫu nhiên lớn "có thể có rất nhiều đáp án khác nhau", trong khi bài trên báo (tranh vẽ tay) thì giải bằng luật từng hàng và luôn duy nhất. Sinh ngẫu nhiên chỉ được phép dùng cho việc *kiểm thử* solver (fuzz), không bao giờ phục vụ người chơi.

### 3.2 Solver — hai tầng

```ts
// lib/nonogram/ (cấu trúc dự kiến, theo khuôn lib/sudoku/)
clues.ts    — suy ra clue hàng/cột từ tranh; so khớp cụm của một hàng hiện tại với clue
solver.ts   — line solver + bộ đếm nghiệm (cap 2) bằng tìm kiếm có lan truyền ràng buộc
pool.ts     — kho tranh đã kiểm chứng + chỉ số độ khó đã tính sẵn
flow.ts     — trạng thái ván: ô (unknown/filled/marked), undo stack, lỗi, hint, thời gian, log nước đi
```

**Tầng 1 — Line solver (giải theo từng hàng/cột):** với mỗi hàng/cột, liệt kê mọi cách đặt các cụm còn hợp lệ với các ô đã biết; ô nào được tô trong *mọi* cách đặt → chắc chắn tô; ô nào trống trong mọi cách đặt → chắc chắn trống. Lặp lại trên toàn bàn tới khi không còn ô mới (fixpoint). Đây chính là thao tác người chơi giỏi làm trong đầu ("chồng lấp từ hai đầu"), nên "line-solvable" là định nghĩa công bằng tự nhiên cho puzzle casual — một bài viết kỹ thuật về sinh đề duy nhất cho cả Sudoku lẫn Nonogram (dev.to, 2025) kết luận đúng điều này: line-solving là tiêu chuẩn *chặt hơn* duy nhất-thuần-túy, và độ chặt đó là tính năng chứ không phải hạn chế đối với game casual. Cài đặt cần cache các cách đặt theo (clue, mặt nạ ô đã biết) vì hàng 15 ô nhiều cụm ngắn có thể bùng nổ số cách đặt — ghi chú hiệu năng có sẵn trong cùng nguồn.

**Tầng 2 — Bộ đếm nghiệm (uniqueness prover):** tìm kiếm theo chiều sâu trên các ô chưa quyết định (chọn ô/hàng bị ràng buộc mạnh nhất), dùng line solver làm lan truyền ràng buộc sau mỗi giả định, **đếm nghiệm tối đa 2 rồi dừng**. Kết quả cho mỗi tranh:
- `solutions === 1` → duy nhất (điều kiện cần tuyệt đối).
- Tầng 1 tự giải hết → `lineSolvable = true` + số liệu độ khó (3.3).
- Tầng 1 kẹt nhưng nghiệm vẫn duy nhất (phải đoán 1 ô rồi suy tiếp) → tranh bị **loại khỏi kho casual**; chỉ giữ lại nếu sau này có hạng "Siêu khó" riêng (không khuyến nghị ở v1 — ⚖️ nằm trong ĐIỂM CHỐT 2 về độ khó: em khuyến nghị v1 chỉ phục vụ bài line-solvable, đúng chuẩn báo giấy).

Cùng một bộ máy này phục vụ luôn ba việc khác: **hint** (ô bị ép buộc tiếp theo mà line solver tìm được, kèm loại lý do: chồng lấp / khóa biên / đếm hoàn tất — như Sudoku hint nêu tên kỹ thuật; mô hình "hint từ cùng solver, hết suy luận mới lộ đáp án" cũng là cách các bản cài đặt tham chiếu đang làm — zayenz.se), **chấm độ khó** (3.3), và **cổng kiểm chứng cộng đồng** nếu sau này mở Xưởng tranh (mục 6.6).

### 3.3 Mô hình độ khó

Độ khó của một bài = tổ hợp **kích thước × mật độ tô × công sức solver**, tính một lần khi tranh vào kho và lưu thành chỉ số (không tính lại lúc chơi):

| Yếu tố | Cách đo | Tác dụng |
|---|---|---|
| Kích thước | 5×5 / 10×10 / 15×15 (mục 4) | Trục chính — chọn ở màn hình Chơi như Caro chọn cỡ bàn |
| Mật độ tô | % ô tô của tranh | Quá thưa (<25%) → clue rời rạc, phải đoán; quá đặc (>75%) → nhàm. Kho giữ dải ~35–65% |
| Số vòng line-solve | Số lượt quét toàn bàn để tới fixpoint | Càng nhiều vòng = phải qua lại hàng↔cột càng nhiều lần |
| Hệ số "hàng khó" | Tỷ lệ hàng/cột mà cách đặt khả thi ban đầu > ngưỡng (phải chồng lấp nhiều lớp mới ép được ô đầu tiên) | Phân biệt bài 10×10 "mượt" với bài 10×10 "gắt" cùng kích thước |

Ánh xạ vào thang gia đình: trong mỗi kích thước, chia 3 mức theo chỉ số solver — **Dễ / Trung bình / Khó** (như Sudoku chia nhóm), XP tính theo (kích thước × mức) ở mục 6.5. Việc chia mức bằng số liệu solver (không phải cảm tính của người vẽ) là điều kiện để thang khó tin cậy được — đúng bài học Sudoku ("difficulty = technique grade, validated empirically").

### 3.4 Định dạng dữ liệu tranh

```ts
interface NoPicture {
  id: string;              // 'apple', 'cat', ... — cũng là khóa Daily/race
  size: 5 | 10 | 15;
  title_vi: string; title_en: string;   // tên tranh — chỉ hiện SAU khi giải xong (trước đó là bí mật vui)
  art: string[];           // size chuỗi, mỗi ký tự: '.' = trống, ký tự khác = tô, khóa vào palette
  palette: Record<string, string>;      // ký tự → mã màu hex (cho màn hình hiện tranh màu)
  grade: { density: number; lineSolvable: true; solveRounds: number; hardLineRatio: number; tier: 1|2|3 };
}
```

- Bitmap giải đố = `art[r][c] !== '.'`. Clue suy ra từ bitmap. Màn hiện tranh màu ánh xạ ký tự → `palette`. Tranh đơn sắc vẫn biểu diễn được (palette một màu) — quyết định màu/đơn sắc ở ĐIỂM CHỐT 7.
- **Daily**: xoay vòng xác định theo ngày trên kho đã kiểm chứng — `index = hash(date) mod poolSize(theo kích thước)`, không lặp cho tới khi hết vòng (như Cờ Úp dùng 30 fixture đã kiểm chứng và Sudoku dùng seed = date; ở đây kho là dữ liệu nên dùng chỉ số ngày thay cho seed). Đề xuất Daily = **3 bài/ngày, mỗi kích thước một bài** (⚖️ ĐIỂM CHỐT 5).
- **Race**: phòng mang `picture_id`; mọi client nạp cùng một tranh từ kho đóng gói trong app (kho là dữ liệu tĩnh trong bundle như pool từ của Word Search) — không cần server giữ đáp án, đúng tiền lệ Sudoku/Word Search.

### 3.5 Hàng rào kiểm thử engine (điều kiện qua giai đoạn 1)

Như Checkers/Ca-rô: engine phải xanh 100% trước khi làm UI.

- Solver đếm nghiệm đúng trên các mẫu kinh điển, gồm mẫu **mơ hồ cố ý** (hình 2×2 kiểu bàn cờ con — hoán đổi được hai đáp án) → phải bị cổng kiểm chứng loại.
- 100% tranh trong kho khởi điểm qua cổng: `solutions === 1 && lineSolvable` (chạy như một test trong CI/bộ test của repo, không tin tay).
- Clue suy ra ↔ áp dụng đáp án tranh gốc: solver giải ra đúng bitmap gốc, từng ô.
- Fuzz: solver không bao giờ treo/quá thời gian trên lưới 15×15 mật độ cực đoan (đặt ngân sách bước tìm kiếm + cache placements).

## 4. Kích thước & vừa màn hình điện thoại (luật cứng của gia đình)

Luật gia đình: **toàn bộ bàn — kể cả rãnh gợi ý — phải thấy trọn trên màn hình điện thoại ~360px, không cuộn, không zoom/pan thay thế**. Khác các game trước, bàn Nonogram gồm lưới chơi **cộng** rãnh số gợi ý ở trên và bên trái; chiều rộng thực tế = (số cột rãnh trái + N) ô. Số cột rãnh trái = số cụm tối đa trong một hàng — kho tranh được kiểm soát để không vượt ngưỡng (tranh vẽ tay tự nhiên hiếm khi quá 4–5 cụm/hàng; cấm checkerboard).

Tính với bề rộng khả dụng ~344px (màn 360px trừ padding của shell):

| Kích thước | Rãnh tối đa (khống chế theo kho) | Tổng đơn vị ngang | Px/ô | Đánh giá |
|---|---|---|---|---|
| 5×5 | 3 | 8 | ~43px | Rất thoải mái — bài làm quen + Puzzle Rush |
| 10×10 | 4 | 14 | ~24.5px | Chuẩn vàng mobile (mục tiêu chạm ≥20px đạt) |
| 15×15 | 5 | 20 | ~17px | Chật nhưng chơi được nhờ kéo-tô (drag paint) — cỡ lớn nhất cho mobile |
| 20×20 | 6 | 26 | ~13px | **Không đạt** — ô nhỏ hơn ngón tay, số gợi ý phải rút xuống ~9px không đọc nổi → **loại khỏi v1** |

Chiều cao cũng phải tính: rãnh trên (tối đa 5 hàng số ở 15×15) + 15 hàng ô ở 17px ≈ 340px cho riêng bàn — vừa khung board-area của shell mà vẫn chừa chỗ cho hàng nút điều khiển dưới bàn theo quy ước (thông tin phụ nằm dưới bàn, cuộn trang được, nhưng **bàn thì không**).

Đối chiếu thị trường: Mario's Picross gốc cũng dừng ở 15×15; Picross 2 lên 30×30 là trên máy chơi game cầm tay có bút/nút bấm chính xác — không phải tiền lệ cho cảm ứng ngón tay. Nonogram Ultra bán các cỡ 5×5, 5×10, 10×10, 10×15 (không vuông) — phương án "10×15" để ngỏ ở ĐIỂM CHỐT 3 nếu anh muốn thêm sau.

**Đề xuất thang kích thước v1: 5×5 · 10×10 · 15×15** (⚖️ ĐIỂM CHỐT 3). Khống chế kho: hàng tối đa 3 cụm (5×5), 4 cụm (10×10), 5 cụm (15×15) — cổng kiểm chứng ở 3.5 kiểm tra luôn điều kiện này để rãnh không bao giờ phình.

## 5. Điều khiển & trải nghiệm chơi

Theo spec UI Shell của skill (header, ngăn kéo, board-area > board-fit, đo board ở 1440×900 và 390×844 mọi view) — chỉ thay bàn và cụm điều khiển đặc thù puzzle như Sudoku đã làm:

- **Ba chế độ tô** (thanh segmented ngay trên bàn, luôn thấy): **■ Tô** · **✕ Đánh dấu** · **⌫ Tẩy**. Chạm ô = áp chế độ hiện tại; chạm
...[truncated 15772 chars] lại ô đã tô bằng chế độ Tô = tẩy ô đó (toggle); chạm ô đã ✕ bằng chế độ ✕ = bỏ dấu.
- **Kéo để tô hàng loạt (drag paint)**: giữ và kéo — khóa trục ngang/dọc theo hướng kéo đầu tiên, tô liên tiếp theo chế độ đang chọn; đây là thao tác bắt buộc phải có ở 15×15 vì ô chỉ ~17px. Bàn đặt `touch-action: none` để kéo không cuộn trang.
- **Nhấn giữ = đánh dấu nhanh** (giữ ô ~350ms khi đang ở chế độ Tô thì đặt ✕ thay vì tô, và ngược lại) — tùy chọn trong Cài đặt, mặc định BẬT như thói quen từ Nonogram.com; trên desktop: chuột phải = ✕, chuột trái = tô.
- **Hoàn tác (Undo)**: không giới hạn, hoàn tác theo từng nét kéo (một lần kéo = một đơn vị undo), có cả nút ↩ trên thanh công cụ như các game gia đình.
- **Phản hồi lỗi**: theo ĐIỂM CHỐT 2 — ô tô sai nhấp nháy đỏ, rung nhẹ + âm "cạch" trầm, bộ đếm lỗi ❤❤❤ trên thanh trạng thái giảm một; ô trở về chưa biết.
- **Trợ giúp hiển thị chuẩn thể loại** (mặc định BẬT, tắt được trong Cài đặt):
  - Tô sáng hàng + cột của ô vừa chạm/đang kéo, kèm tô sáng dãy số gợi ý tương ứng.
  - **Số gợi ý tự mờ khi hoàn thành**: khi cụm ô tô hiện tại của một hàng/cột khớp đúng dãy gợi ý của nó, dãy số mờ đi (và gạch nhẹ) — báo "hàng này xong phần tô".
  - Hàng/cột đã quyết định xong toàn bộ thì nền rãnh chuyển tông khác nhẹ.
- **Gợi ý (Hint)**: tối đa 3 lần/ván miễn phí (tiền lệ Sudoku); mỗi lần hint, line solver chỉ ra một ô *suy ra được* + lý do ngắn ("Chồng lấp: cụm 5 trong hàng này dù đặt ở đâu cũng phủ ô này") bằng VI/EN; hết suy luận logic thì mới lộ một ô từ đáp án (và nói rõ đó là lộ đáp án). Dùng hint không tính lỗi nhưng ván đó mất huy hiệu "Hoàn hảo".
- **Đồng hồ**: đếm xuôi, hiện trên thanh trạng thái (⚖️ ĐIỂM CHỐT 6 — mặc định hiện); tạm dừng khi chuyển tab/rời màn hình như Sudoku; không có giới hạn giờ ở chơi đơn.
- **Kết ván — khoảnh khắc hiện tranh**: lưới khóa, chạy hoạt cảnh quét sáng, rồi **bức tranh chuyển thành bản MÀU** (ánh xạ palette) + hiện tên tranh + confetti nhẹ như các game gia đình; hai nút hành động chính: **Chia sẻ bức tranh** (ảnh khoe = chính bức tranh màu trên nền thẻ thương hiệu in `nonogram.synerworlds.com`, text kèm URL đầy đủ — đúng quy ước share của gia đình) và **Ván mới**. Đây được xác định là vòng lặp lan truyền chính của game này: tranh đẹp → muốn khoe → người xem tò mò muốn tự giải.
- **Lưu ván dở**: localStorage như Sudoku (theo từng kích thước), mở lại là chơi tiếp; sự kiện `start`/`abandon` ghi nhận đúng thời điểm theo `references/stats.md`.

## 6. Các chế độ chơi theo khuôn gia đình

### 6.1 Chơi (Play)
Chọn kích thước (5/10/15) × mức khó (Dễ/Trung bình/Khó theo chỉ số solver) → bốc một tranh chưa chơi gần đây trong kho của ô đó (xoay vòng ngẫu nhiên có seed thời gian như Sudoku bốc đề mới). Thắng/thua ghi qua RPC `no_record_game_result` (mục 7).

### 6.2 Câu đố mỗi ngày (Daily)
Mỗi ngày 3 bài (mỗi kích thước một bài), chọn xác định theo ngày từ kho, **cả cộng đồng chơi cùng 3 bức tranh**; hoàn thành cộng thêm XP ngày (ledger chống trùng như Sudoku) và nuôi streak câu đố của gia đình. (Số bài/ngày là ⚖️ ĐIỂM CHỐT 5.)

### 6.3 Phòng đua (Race rooms) — 2–4 người
Theo **đúng mô hình đua của Sudoku/Cross Words/Word Search** (không phải đối kháng lượt đi):
- Chủ phòng chọn kích thước + mức khó; ván mang `picture_id` lấy từ kho theo seed của phòng; mọi client nạp cùng tranh, đáp án nằm ở client như Sudoku race vẫn làm.
- Mỗi người giải trên bàn của mình; tiến độ báo qua RPC `no_update_progress` — **chỉ số % ô tô đúng + số lỗi + đã xong**, khán giả và đối thủ chỉ thấy thanh % (không thấy bàn nhau — khác Sudoku ở điểm này: bàn Nonogram *chính là* đáp án đang vẽ dở, xem trộm = sao chép; chỉ số % là đủ kịch tính).
- Về đích đúng đầu tiên thắng; xếp hạng theo (đã xong → thời gian → ít lỗi hơn); **XP hạng 15/10/7/5**; **Elo chỉ đổi ở đây**, tính pairwise như Sudoku (khởi điểm 800, K40→24, sàn 100).
- Bộ phòng đầy đủ của gia đình đi kèm: chat riêng trong phòng, voice, xóa phòng, promo card, spectator (khán giả xem thanh tiến độ + xem bàn của người đã về đích sau khi ván kết thúc).
- **Thách đấu bạn bè = lời mời vào phòng đua** (deep link `?challenge=`, chấp nhận là được đưa thẳng vào phòng — luật gia đình 2026-10-16).

**Vào v1 hay để sau? (⚖️ ĐIỂM CHỐT 4)** — Khuyến nghị: **vào v1**. Lý do: toàn bộ hạ tầng đua đã có sẵn khuôn từ Sudoku (rooms suite + RPC mẫu), phần riêng của Nonogram chỉ là tiến độ % thay vì số ô đã điền; và phòng đua là nơi duy nhất Elo chạy — thiếu nó thì bảng xếp hạng của game không có "mạch máu" như Sudoku bản đầu từng phải bổ sung. Chi phí tăng thêm ước lượng nhỏ so với rủi ro phải quay lại vá kiến trúc.

### 6.4 Puzzle Rush — đánh giá thẳng
Puzzle Rush của gia đình = giải liên tiếp bài nhỏ chống giờ, sai 3 lần là dừng. Với Nonogram: một bài 5×5 giải trong ~20–60 giây, kho 5×5 làm quen có sẵn — **khớp một cách tự nhiên, thậm chí có tiền lệ quốc tế** (Picross DS có Nonstop Time Attack: giải liên tiếp bài đơn giản càng nhanh càng tốt). Đề xuất dạng: **3 phút, mỗi bài 5×5 giải xong +10 giây, 3 lỗi = kết thúc**, điểm = số bài × độ chính xác; nuôi streak Rush như các game khác.
**Khuyến nghị: làm ở v1.1 (fast-follow), không chặn ngày ra mắt** — v1 đã gồm Play + Daily + Race + Bí Kíp; Rush dùng lại toàn bộ hạ tầng Play nên bổ sung sau rất rẻ, nhưng nhét vào v1 làm tăng bề mặt kiểm thử engine/kho (kho 5×5 phải đủ sâu cho Rush chạy dài). Ghi vào lộ trình (mục 9) để anh thấy rõ nó không bị quên.

### 6.5 Điểm số / XP / Elo (theo tiền lệ Sudoku — solo không động vào Elo)
| Sự kiện | XP |
|---|---|
| Giải xong 5×5 | Dễ 15 · TB 20 · Khó 25 |
| Giải xong 10×10 | Dễ 30 · TB 40 · Khó 50 |
| Giải xong 15×15 | Dễ 55 · TB 70 · Khó 90 |
| Thua (3 lỗi / bỏ cuộc) | 5 |
| Daily | Cộng +10/bài, tối đa 1 lần/ngày/kích thước (ledger) |
| Phòng đua | Theo hạng: 15/10/7/5 + Elo pairwise (800, K40→24, sàn 100) |
| Hoàn hảo (0 lỗi, 0 hint) | Huy hiệu trên thẻ lịch sử + điểm nhấn ở màn kết ván (không cộng XP — chống cày) |
Bảng `no_stats` giữ nguyên hình dạng gia đình (xp, wins, losses, draws, games_played, rating, peak_rating) để hub aggregator + leaderboard chạy không đổi; leaderboard xếp rating-first như mọi game.

### 6.6 Bí Kíp (Library) — 6 bài học kỹ thuật
Tiến độ qua bảng dùng chung `library_progress` (id tiền tố `no-`), mỗi bài có bàn drill nhỏ được solver kiểm chứng như quy ước gia đình:
1. **Đọc gợi ý & hai cực trị** — hàng đầy (clue = N) và hàng trống (clue 0); khoảng cách tối thiểu giữa các cụm.
2. **Chồng lấp hai đầu** — kỹ thuật cốt lõi: đặt cụm ở vị trí trái nhất/phải nhất, phần giao nhau chắc chắn được tô.
3. **Khóa biên** — cụm đầu tiên khi ô đầu hàng đã biết trạng thái; tận dụng mép bàn.
4. **Đếm hoàn tất** — khi tổng các cụm + khoảng trống tối thiểu vừa khít độ dài hàng: cả hàng bị ép hoàn toàn.
5. **Suy từ ô giao** — dùng cột để khóa hàng và ngược lại; thói quen quét xen kẽ hàng↔cột.
6. **Loại trừ & giả định có kiểm soát** — khi line-solving kẹt: thử một ô, mâu thuẫn thì đảo ngược (và hiểu vì sao bài của SynerWorlds luôn giải được *không cần* bước này ở mức Dễ/TB).

### 6.7 Cộng đồng / Xưởng tranh (để ngỏ v2, chừa sẵn đường)
Game này có UGC tự nhiên nhất gia đình: người chơi **vẽ một bức tranh → hệ thống suy ra clue → solver kiểm chứng duy nhất + line-solvable → đăng thành câu đố cộng đồng** (đúng mẫu prove-it-first của Community Puzzles; Picross DS từng có "My Picross" với đúng luồng này). Đề xuất v1: **chỉ chừa sẵn bảng `no_puzzles` dormant trong migration như tiền lệ Sudoku** (bảng cộng đồng của Sudoku cũng ship dormant ở v1), mở tính năng ở v2 khi kho tranh chính đã ổn. Setup editor kiểu "đặt thế cờ" không tồn tại trong game này — Xưởng tranh chính là dạng editor tương ứng, và không có CvC (không có đối thủ AI; mục này Sudoku cũng đã loại).


## 7. Checklist khuôn gia đình (đối chiếu skill `local-boardgame-engagement`)

Nonogram là game puzzle solo-first như Sudoku — lấy cây **Sudoku/Word Search** làm nền port (nhanh và đúng khuôn nhất), thay lõi board/rules:

- [ ] **UI Shell**: copy spec + `pacclone-shell.css`, thay theme tokens; board qua `.board-area > .board-fit` (bàn Nonogram là hình vuông kể cả rãnh — fit theo cạnh ngắn); đo kích thước board ở 1440×900 và 390×844 mọi view; header/ngăn kéo/footer giữ nguyên khuôn (Sudoku đã lược Setup + CvC khỏi ngăn kéo — giữ nguyên cách lược đó).
- [ ] **Tài khoản/SSO**: cookie dùng chung `.synerworlds.com` qua @supabase/ssr trên project Supabase chung; `profiles` dùng chung (không có cột email); anh thêm redirect URL `https://nonogram.synerworlds.com` vào Supabase Auth như các game trước.
- [ ] **Tiền tố DB: `no_`** — đã rà soát toàn bộ migrations + `game_registry` của 14 game: các tiền tố đã dùng là `xq_`(profiles), `chess_`, `cct_`, `cg_`, `cn_`, `oq_`, `cng_`, `sud_`, `cv_`, `cw_`, `ws_`, `chk_`, `cr_`, `cu_`; **không tồn tại bảng/RPC/registry nào dùng `no_`** (cũng đã kiểm tra hai ứng viên dự phòng `ng_`, `nn_` — đều trống, nhưng `no_` rõ nghĩa nhất: **No**nogram).
- [ ] **Stats + sự kiện**: bảng `no_stats` (hình dạng gia đình) + `no_game_events` (start/finish/abandon qua RPC DEFINER theo `references/stats.md`, khách cũng ghi) + RPC `no_game_stats()` cho tab Thống kê trong Bảng xếp hạng; **footer động + hub_stats tự nhận game** ngay khi có hàng registry + sự kiện `finish` (kinh nghiệm các game trước: hub không cần sửa gì).
- [ ] **Hub registry**: một hàng `game_registry` — slug `nonogram`, stats_source `no_stats`, prefix `no_`, **sort 98** (sau co-up = 97, hiện là giá trị lớn nhất), site_url `https://nonogram.synerworlds.com`, accent + icon theo ĐIỂM CHỐT 8.
- [ ] **Điểm danh + streak, Nhiệm vụ (quests), bonus chào mừng**: nguyên khuôn gia đình.
- [ ] **Bảng xếp hạng**: spec chuẩn (🏆/📊, thẻ hạng của tôi, podium, phân trang 15, hạng toàn cục, xếp theo rating).
- [ ] **Lịch sử ván**: lưu `picture_id` + kích thước/mức + log nước đi (chuỗi ô thay đổi + dấu lỗi, như Sudoku lưu `c<cell>=<digit>`) → replay tái hiện quá trình giải trên bàn tĩnh + video export theo timeline gia đình (khoảnh khắc quyết định = ô tô đúng cuối cùng → hiện tranh màu; thẻ đầu/cuối in tên miền chuẩn).
- [ ] **Phòng chơi**: theo 6.3 — gồm chat riêng trong phòng, voice, xóa phòng, promo card, giải đấu phòng nhỏ (bracket trên cùng một mô hình đua) nếu khuôn Sudoku đã có sẵn thì port theo; cờ thư **không áp dụng** (puzzle đua không có lượt qua lại — Sudoku cũng để dormant).
- [ ] **Bạn bè & thách đấu**: dùng chung `friendships`; thách đấu = mời đua (6.3).
- [ ] **Phát trực tiếp (Go Live)**: port nguyên bộ LiveKit của 14 game (key của người chơi chỉ ở localStorage của họ, API `/api/live/token|start|stop` auth-gated, env `LIVEKIT_*` anh gắn); tên miền in trên thanh thương hiệu + thẻ intro/outro là `nonogram.synerworlds.com`.
- [ ] **Chia sẻ/Khoe**: shareCard bức tranh hoàn thành (mục 5) + achievementCard + referralCard — **ghim cứng tên miền chuẩn**, không dùng `window.location.origin`.
- [ ] **Thông báo đẩy**: VAPID như gia đình (được thách đấu đua, phòng sắp bắt đầu) + hộp thư trong app.
- [ ] **PWA**: manifest + service worker + icon SVG (không commit PNG qua ghpush — `app/icon.svg` + `apple-icon.tsx` như quy ước).
- [ ] **i18n VI/EN đầy đủ** qua interface `Strings` (VI mặc định), khóa theo tiền tố game như các repo trước.
- [ ] **GA4 — bắt buộc khi ra mắt**: `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-K4D5YN3X88` (một property gia đình, hostname tự tách traffic) trong `.env.local` + Vercel env, pattern next/script + PageViewTracker theo skill `local-google-analytics`; trang /privacy khai báo GA như các trang đã sửa 2026-10-21.
- [ ] **Footer động**: tự động qua cơ chế `footer_top()` — việc duy nhất phải làm tay một lần: thêm nhãn của Nonogram vào mảng fallback cứng trong `SiteFooter.tsx` của các repo (và hub Admin sửa được nhãn trong bảng xếp hạng nếu cần).
- [ ] **Guides**: mục Guides trong ngăn kéo trỏ về hub blog `https://synerworlds.com/blog?cat=nonogram`; category blog mới trên hub khi có bài ra mắt (cặp VI+EN như Cờ Úp).
- [ ] **Trang /privacy + /terms**: theo mẫu hub hiện hành (đã có đoạn GA).

## 8. Dữ liệu & tính toàn vẹn (ngắn gọn — game này không có thông tin ẩn)

- Đáp án tranh nằm trong bundle client (như đáp án Sudoku) — người quyết tâm mở DevTools xem đáp án là đánh đổi đã chấp nhận của cả họ puzzle gia đình; Elo phòng đua vì vậy là Elo "vui có kiểm chứng mức gia đình": server không tin lời khai suông — RPC về đích `no_finish_room_match` tự suy ra thứ hạng từ tiến độ đã báo (tiền lệ Word Search: server derives `solved` from reported progress), và tiến độ chỉ được công nhận tăng dần theo thời gian hợp lệ (ô đúng không thể nhảy cóc 0→100% trong vài giây — ngưỡng tốc độ tối thiểu theo kích thước, như cổng ≥20 ô trống của Sudoku).
- Mọi RPC ghi XP/Elo/check-in: SECURITY DEFINER, `revoke all ... from public` + `revoke ... from anon`, grant đúng vai trò; biến plpgsql tiền tố `v_`; migration qua harness PGlite grant-faithful và **thực thi thử** các hàm như quy ước gia đình trước khi dán cho anh chạy; tuyệt đối không có DELETE/UPDATE trần không WHERE (bài học pg_safeupdate 2026-10-21 — dùng `where true` khi cần xóa toàn bảng).
- Các bảng dự kiến: `no_stats`, `no_games`, `no_rating_history`, `no_checkins`, `no_game_events`, `no_rooms`, `no_room_members`, `no_matches` (đua), `no_room_messages`, `no_room_comments`, `no_tournaments`, `no_puzzles` (dormant cho Xưởng tranh v2); RPC: `no_record_game_result`, `no_update_progress`, `no_finish_room_match`, `no_claim_checkin`, bộ rooms/challenge theo khuôn Sudoku.

## 9. Lộ trình xây dựng theo giai đoạn

Theo nhịp quen thuộc: **code trước → SQL gộp theo đợt → anh chạy SQL + gắn env → deploy và kiểm chứng production**. Điều kiện khởi công: anh duyệt mục 10 (+ repo `mycheesevn/Nonogram` và project Vercel `nonogram` anh đã cung cấp sẵn).

| Giai đoạn | Nội dung | Kiểm chứng |
|---|---|---|
| 0. Chốt thiết kế | Anh duyệt mục 10 (tên/slug/màu/luật lỗi/kích thước/phòng đua v1) | — |
| 1. Engine + kho tranh | `lib/nonogram/`: clues, solver 2 tầng, chấm độ khó, flow; bộ test 3.5; vẽ + kiểm chứng **kho khởi điểm 90 tranh** (30 tranh/kích thước, đủ 3 mức khó mỗi kích thước) | Bộ test xanh 100%: mọi tranh `solutions===1 && lineSolvable`, mẫu mơ hồ bị loại, fuzz không treo |
| 2. Khung gia đình | Port cây Sudoku: shell + auth/SSO + stats/events + check-in/quests + leaderboard + history/replay | tsc + build xanh; SQL qua harness PGlite (thực thi RPC như authenticated) |
| 3. Chơi đơn | Play (3 kích thước × 3 mức), Daily 3 bài/ngày, Bí Kíp 6 bài, lưu ván dở, màn hiện tranh + chia sẻ | Đo board mọi view (desktop + 390×844); test tay kéo-tô trên mobile thật |
| 4. Phòng đua | Rooms suite (đua 2–4) + chat riêng + voice + xóa phòng + thách đấu + spectator % | Hai tài khoản test (Mai Chi vs Kiên) đua trọn ván ở cả 3 kích thước; Elo/XP đối chiếu tay |
| 5. Tăng trưởng | Go Live, push, referral, hub registry (sort 98) + nhãn footer fallback, blog category + bài ra mắt VI/EN, GA4 | Deploy production: mở URL thật, `footer_top()` có nonogram sau ván đầu, POST /api/live/token ẩn danh → 401 |
| 6. Kiểm toán chéo | Audit parity với Sudoku + PacClone theo skill (quy ước đứng của anh), sửa mọi lệch, deploy, báo cáo | Checklist parity ký đóng |
| v1.1 | **Puzzle Rush** (3 phút, 5×5, +10s/bài, 3 lỗi dừng) | Như giai đoạn 4 rút gọn |
| v2 | **Xưởng tranh cộng đồng** (vẽ → kiểm chứng solver → đăng; likes/solves/XP tác giả theo mẫu Community Puzzles) | Cổng kiểm chứng = solver của giai đoạn 1 |

## 10. Các điểm cần anh chốt ⚖️

| # | Điểm | Các lựa chọn | **Khuyến nghị của em** |
|---|---|---|---|
| 1 | **Tên hiển thị** | (a) **Nonogram** (cả VI lẫn EN — như Sudoku giữ tên phổ quát); (b) Nonogram kèm phụ đề Việt kiểu "Nonogram — Tranh Logic" | **(a)** — "Nonogram" là thuật ngữ chung quốc tế, người Việt tìm kiếm app cũng gõ đúng từ này; "Picross" là nhãn hiệu Nintendo nên không dùng làm tên. Tên là quyền của anh như mọi game trước — em không tự quyết |
| 2 | **Chính sách lỗi sai** | (a) 3 lỗi, báo ngay, ô sai bị gỡ (tiền lệ Sudoku); (b) Phạt giờ leo thang 2/4/8 phút kiểu Mario; (c) Không phạt kiểu Picross S | **(a)** — nhất quán gia đình, giữ tính logic, hợp với đua phòng. Đánh dấu ✕ sai không bao giờ tính lỗi |
| 3 | **Thang kích thước** | (a) 5×5 · 10×10 · 15×15; (b) thêm 20×20; (c) thêm cỡ chữ nhật 10×15 kiểu Nonogram Ultra | **(a)** — 20×20 chỉ đạt ~13px/ô trên điện thoại, phá luật "thấy trọn bàn, không zoom" (bảng đo ở mục 4). (c) để ngỏ v2 nếu anh muốn |
| 4 | **Phòng đua ở v1 hay v1.1** | (a) v1 (kèm chat/voice/xóa phòng như khuôn); (b) ra mắt solo trước, đua bổ sung ngay sau | **(a)** — khuôn đua có sẵn từ Sudoku, và Elo/bảng xếp hạng cần phòng đua ngay từ đầu (mục 6.3) |
| 5 | **Daily: số bài & cỡ kho** | (a) 3 bài/ngày (mỗi kích thước 1 bài), kho khởi điểm 90 tranh; (b) 1 bài/ngày 10×10, kho 60 | **(a)** — 3 bài nuôi thói quen đủ sâu cho cả người chơi nhanh (5×5) lẫn người chơi nặng (15×15); 90 tranh = 30 ngày không lặp lại ở mỗi kích thước, đủ thời gian bổ sung kho |
| 6 | **Đồng hồ** | (a) Hiện đếm xuôi mặc định; (b) Ẩn mặc định, bật trong Cài đặt | **(a)** — như Sudoku; thời gian là một nửa niềm vui của puzzle (thành tích cá nhân, xếp hạng đua cần nó) |
| 7 | **Tranh hiện cuối ván: có màu hay đơn sắc** | (a) Chơi đơn sắc, thắng hiện **bản màu** (kho tranh mang sẵn bảng màu); (b) Đơn sắc từ đầu đến cuối | **(a)** — khoảnh khắc màu hiện ra là phần thưởng + ảnh khoe đẹp hơn hẳn (tiền lệ Nintendo: tranh màu là phần thưởng). Chi phí: người vẽ tranh phải gán màu khi vẽ — không tốn thêm bước kiểm chứng |
| 8 | **Màu nhấn + biểu tượng** | Màu: (a) **Hồng magenta `#db2777`** — tươi, đậm chất pixel/pop, chưa game nào dùng; (b) **Vàng nghệ `#eab308`** — ấm, gợi giấy bút chì; (c) **Xanh lime `#65a30d`** — tách hẳn khỏi xanh emerald của Cờ Nhào `#16a34a`. Biểu tượng: (a) **🖼️** (bức tranh — đúng bản chất "tranh ẩn"); (b) 🧩; (c) 🔲 | Màu **(a)** + biểu tượng **(a)** — cặp này nhận diện được ngay trong footer/danh sách 15 game và không đụng bất kỳ màu nào đã dùng (#c0392b, #34495e, #7d3c98, #2569b8, #16a34a, #8a6d4a, #b91c1c, #2563eb, #a3622a, #b45309, #0f766e, #991b1b, #0e7fa8, #701e24). Quyết cuối là của anh |
| 9 | **Slug / tên miền** | (a) `nonogram.synerworlds.com`; (b) khác | **(a)** — khớp tên game + từ khóa tìm kiếm; repo `mycheesevn/Nonogram` + project Vercel `nonogram` anh đã tạo sẵn theo đúng slug này |

## 11. Nguồn tham khảo (toàn bộ)

- Luật & biến thể: các nguồn ở mục 2.3 (Easybrain/Nonogram.com qua Similarweb, Metacritic Picross S, TV Tropes Picross, Mario's Super Picross, Picross DS/Time Extension, Nonogram Ultra support).
- Solver & sinh đề duy nhất: "Generating puzzles with exactly one solution: Sudoku, Nonogram and a daily seed, in plain JavaScript" — dev.to (line solver liệt kê cách đặt, giao nhau giữa các cách đặt, "line-solvable là định nghĩa công bằng", cache placements cho 15×15): https://dev.to/selenium39dev/generating-puzzles-with-exactly-one-solution-sudoku-nonogram-and-a-daily-seed-in-plain-javascript-1f57
- "Solving Nonogram with Code" — lihautan.com (backtracking + kiểm tra ràng buộc từng phần): https://lihautan.com/solving-nonogram-with-code
- vita (morinim) — nonogram tutorial trên GitHub Wiki: bài tổng quát là NP-khó; bài báo giấy giải bằng luật từng hàng và duy nhất; bài ngẫu nhiên lớn nhiều đáp án: https://github-wiki-see.page/m/morinim/vita/wiki/nonogram_tutorial
- "From constraint models to playable puzzle games" — zayenz.se: bộ sinh giữ tranh nguồn qua kiểm tra duy nhất; hint dùng chung mô hình hàng (báo ô mâu thuẫn trước, rồi ô bị ép, cuối mới lộ đáp án): https://zayenz.se/blog/post/constraint-generated-puzzle-games/
- Tiền lệ nội bộ: `sudoku/docs/DESIGN.md` (12 mức → rút thành kích thước × 3 mức ở đây, giới hạn 3 lỗi báo ngay, đua seed, XP 15/10/7/5, Elo chỉ ở phòng đua), `wordsearch/docs/DESIGN.md` (tiền tố `ws_`, server tự suy ra kết quả đua), `co-up/design.md` (khuôn tài liệu thiết kế + fixture đã kiểm chứng cho Daily), skill `local-boardgame-engagement` + references (ui-shell, stats, growth/GA4, retention, rooms, library) và registry thực tế trong migrations của 14 game (rà soát tiền tố + sort ngày 2026-10-21).

---

*Hết bản thiết kế. Các quyết định ở mục 10 chờ anh duyệt; duyệt xong em bắt đầu từ Giai đoạn 1 (engine + solver + kho tranh kiểm chứng) như quy trình các game trước.*
