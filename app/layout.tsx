import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import { PageViewTracker } from "@/components/PageViewTracker";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export const metadata: Metadata = {
  title: "Nonogram — trò chơi tranh logic (Picross)",
  description:
    "Chơi Nonogram (Picross) miễn phí: 3 kích thước bàn, 3 mức khó, 3 puzzle mới mỗi ngày, gợi ý theo suy luận, đua Nonogram 2–4 người trong phòng chơi. Tiếng Việt & English.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14100c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        {GA_ID && (<>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="gtag-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}</Script>
        </>)}
        {GA_ID && (<Suspense fallback={null}><PageViewTracker gaId={GA_ID} /></Suspense>)}
        {children}
      </body>
      <Script id="sw-register" strategy="afterInteractive">
        {`if ("serviceWorker" in navigator) {
          if (document.readyState === "complete") {
            navigator.serviceWorker.register("/sw.js").catch(function () {});
          } else {
            window.addEventListener("load", function () {
              navigator.serviceWorker.register("/sw.js").catch(function () {});
            });
          }
        }`}
      </Script>
    </html>
  );
}
