import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nonogram",
    short_name: "Nonogram",
    description:
      "Chơi Nonogram (Picross) miễn phí: tranh logic 5×5–15×15, puzzle mỗi ngày, phòng đua 2–4 người.",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
