import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Chính sách riêng tư / Privacy Policy — Nonogram" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px", lineHeight: 1.65 }}>
      <h1>Chính sách riêng tư — Nonogram</h1>
      <p>Nonogram là trò chơi giải đố logic bằng tranh điểm ảnh chạy trên trình duyệt của bạn. Ở phiên bản hiện tại, trò chơi không thu thập, không lưu trữ và không chia sẻ bất kỳ dữ liệu cá nhân nào ngoài những gì bạn tự tạo qua tài khoản SynerWorlds (hồ sơ, điểm số, lịch sử ván) khi đăng nhập. Tiến trình chơi chỉ nằm trong bộ nhớ của trang; khi bạn đóng tab, ván chơi kết thúc.</p>
      <p>Ứng dụng có thể dùng bộ nhớ cục bộ (localStorage) để ghi nhớ tùy chọn của bạn như ngôn ngữ, âm thanh và kích thước bàn ưa thích. Bạn có thể xóa các dữ liệu này bất cứ lúc nào trong phần cài đặt của trình duyệt.</p>
      <p>Trang web sử dụng Google Analytics để hiểu khách truy cập đến từ đâu và cách trang được sử dụng, nhằm cải thiện trò chơi. Google Analytics đặt cookie phân tích (ví dụ _ga); trang không dùng cookie quảng cáo và dữ liệu phân tích không được bán.</p>
      <p><em>Nonogram is a picture logic puzzle game that runs in your browser. This version collects, stores, and shares no personal data beyond what you create through your SynerWorlds account (profile, scores, game history) when signed in. Preferences such as language, sound, and preferred board size may be kept in localStorage and can be cleared in your browser settings at any time. This site uses Google Analytics to understand where visitors come from and how the site is used, in order to improve it; Google Analytics sets analytics cookies (e.g. _ga); no advertising cookies are used, and analytics data is not sold.</em></p>
      <p><Link href="/">← Quay lại trò chơi / Back to the game</Link></p>
    </main>
  );
}
