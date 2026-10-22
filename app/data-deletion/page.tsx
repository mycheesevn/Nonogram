import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Xóa dữ liệu / User Data Deletion — Nonogram",
};

export default function DataDeletion() {
  return (
    <main className="sud-legal-page">
      {/* ---------------- Vietnamese ---------------- */}
      <Link href="/" className="back">
        ← Nonogram
      </Link>
      <h1>Xóa dữ liệu người dùng</h1>
      <p className="updated">Cập nhật lần cuối: 13 tháng 10, 2026</p>
      <p>
        Bạn có thể xóa dữ liệu của mình khỏi trò chơi Nonogram bất cứ lúc
        nào. Trang này hướng dẫn cách thực hiện.
      </p>

      <h2>1. Tự xóa ván cờ đã lưu</h2>
      <p>
        Mở tab Lịch sử (menu ☰ → Lịch sử). Tại đây bạn có thể xóa từng ván cờ đã
        lưu, và việc xóa có hiệu lực ngay lập tức.
      </p>

      <h2>2. Xóa toàn bộ tài khoản</h2>
      <p>
        Để xóa tài khoản và toàn bộ dữ liệu liên quan (hồ sơ, ván cờ đã lưu,
        thống kê thắng–thua), hãy gửi email đến{" "}
        <strong>[địa chỉ email liên hệ — thay bằng email của bạn]</strong> và yêu
        cầu xóa tài khoản. Vui lòng ghi rõ địa chỉ email bạn đã dùng để đăng ký.
      </p>
      <p>
        Chúng tôi sẽ xóa tài khoản và toàn bộ dữ liệu liên quan trong vòng 30
        ngày kể từ khi nhận được yêu cầu, và xác nhận sau khi hoàn tất.
      </p>

      <h2>3. Những gì sẽ bị xóa</h2>
      <p>
        Hồ sơ, địa chỉ email, các ván cờ đã lưu (nước đi, kết quả, cài đặt) và
        thống kê (XP, thắng, thua, hòa) của bạn. Dữ liệu được xóa khỏi cơ sở dữ
        liệu Supabase của chúng tôi. Các nhật ký kỹ thuật ẩn danh của nhà cung
        cấp hosting (Vercel) có thể còn lưu trong thời gian ngắn theo chính sách
        của họ.
      </p>

      <h2>4. Đăng nhập bằng Facebook hoặc Google?</h2>
      <p>
        Việc gỡ ứng dụng của chúng tôi khỏi cài đặt Facebook (Cài đặt → Ứng dụng
        và trang web) hoặc khỏi tài khoản Google chỉ thu hồi quyền truy cập,
        không tự động xóa dữ liệu đã lưu chỗ chúng tôi. Để xóa dữ liệu đó, hãy
        làm theo các bước trên.
      </p>

      <hr className="sud-legal-sep" />

      {/* ---------------- English ---------------- */}
      <h1>User Data Deletion</h1>
      <p className="updated">Last updated: October 13, 2026</p>
      <p>
        You can delete your data from our Nonogram game at any time. This
        page explains how.
      </p>

      <h2>1. Delete saved games yourself</h2>
      <p>
        Open the History tab (menu ☰ → History). There you can delete any saved
        game individually, and deletions take effect immediately.
      </p>

      <h2>2. Delete your entire account</h2>
      <p>
        To delete your account and all associated data (profile, saved games,
        win–loss statistics), send an email to{" "}
        <strong>[contact email — replace with your email]</strong> and request
        account deletion. Please include the email address you used to sign up.
      </p>
      <p>
        We will delete your account and all associated data within 30 days of
        receiving your request, and confirm once it is done.
      </p>

      <h2>3. What gets deleted</h2>
      <p>
        Your profile, email address, saved games (moves, results, settings), and
        statistics (XP, wins, losses, draws). Data is removed from our Supabase
        database. Anonymous technical logs kept by our hosting provider (Vercel)
        may persist briefly under their own retention policy.
      </p>

      <h2>4. Signed in with Facebook or Google?</h2>
      <p>
        Removing our app from your Facebook settings (Settings → Apps and
        Websites) or from your Google account revokes our access, but does not
        automatically delete data already stored with us. To delete that stored
        data, follow the steps above.
      </p>
    </main>
  );
}
