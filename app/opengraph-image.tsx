import { ImageResponse } from "next/og";

export const alt = "Nonogram — trò chơi tranh logic (Picross)";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#db2777";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#14100c",
          padding: "64px 72px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              width: 120,
              height: 10,
              borderRadius: 5,
              backgroundColor: ACCENT,
              marginBottom: 44,
            }}
          />
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.15,
            }}
          >
            Nonogram — Picross
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 34,
              color: "#d6cfc4",
              lineHeight: 1.4,
            }}
          >
            Trò chơi tranh logic: 3 kích thước bàn, 3 mức khó, 3 puzzle mới mỗi ngày, đua Nonogram 2–4 người.
          </div>
        </div>
        <div
          style={{
            fontSize: 26,
            color: ACCENT,
          }}
        >
          SynerWorlds · Chơi miễn phí trên trình duyệt · Free to play in your browser
        </div>
      </div>
    ),
    { ...size },
  );
}
