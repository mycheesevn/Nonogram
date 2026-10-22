import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Điều khoản sử dụng / Terms — Nonogram" };

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px", lineHeight: 1.65 }}>
      <h1>Điều khoản sử dụng — Nonogram</h1>
      <p>Nonogram được cung cấp miễn phí cho mục đích giải trí và học tập. Luật chơi áp dụng là luật dân gian: mỗi lượt bốc hết quân trong một ô dân của mình rồi rải mỗi ô một quân sang các ô kề tiếp (kể cả ô quan); rải hết mà ô sau còn quân thì bốc rải tiếp, gặp ô trống rồi đến ô có quân thì ăn quân và có thể ăn chuyền nhiều ô; ô quan chỉ bị ăn khi có từ 5 quân dân trở lên đi kèm ("quan non" không ăn được). Ván kết thúc khi cả hai quan đều bị ăn; 1 quan = 10 dân, nhiều điểm hơn thắng. Kết quả ván đấu với máy chỉ phục vụ giải trí.</p>
      <p><em>Nonogram is provided free of charge for entertainment and learning. The game applies the traditional rules: each turn you pick up all the stones in one of your citizen squares and sow one per square into the following squares (including the Mandarin squares); when your hand is empty you keep sowing from the next square if it holds stones, and capture across one empty square — captures may chain; a Mandarin square can only be captured while it holds at least 5 citizen stones alongside its Mandarin piece. The game ends when both Mandarin pieces are captured; 1 Mandarin = 10 stones, most points wins.</em></p>
      <p><Link href="/">← Quay lại trò chơi / Back to the game</Link></p>
    </main>
  );
}
