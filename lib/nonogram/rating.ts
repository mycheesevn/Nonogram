// Player rating (Elo) display helpers — bands and titles ported from
// PacClone (lib/xiangqi/rating.ts), identical across the family.
// The Elo MATH lives server-side in migration 006 (no_record_game_
// result): start 800, AI pseudo-ratings 300…2400 by level, K = 40
// under 20 games else 24, floor 100, peak tracked in no_stats.

import type { Lang } from "./i18n";

export const START_RATING = 800;

export interface RatingBand {
  min: number;
  vi: string;
  en: string;
}

export const RATING_BANDS: RatingBand[] = [
  { min: 1800, vi: "Đại Kiện Tướng", en: "Grandmaster" },
  { min: 1500, vi: "Kiện Tướng", en: "Master" },
  { min: 1200, vi: "Cao Cấp", en: "Advanced" },
  { min: 900, vi: "Trung Cấp", en: "Intermediate" },
  { min: 600, vi: "Sơ Cấp", en: "Beginner" },
  { min: 0, vi: "Tân Thủ", en: "Novice" },
];

/** Title for a rating, e.g. "Kiện Tướng". */
export function ratingTitle(rating: number, lang: Lang): string {
  const band =
    RATING_BANDS.find((b) => rating >= b.min) ??
    RATING_BANDS[RATING_BANDS.length - 1];
  return lang === "vi" ? band.vi : band.en;
}
