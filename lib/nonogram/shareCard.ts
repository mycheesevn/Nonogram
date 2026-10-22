"use client";
/**
 * Share cards for Nonogram — 1080×1350 canvas PNGs on the family
 * brand frame (dark background, app name, canonical host CTA).
 * Two cards: the generic profile/rank card (renderShareCard) and the
 * game's signature card — the finished COLOR picture itself
 * (sharePictureCard), the win moment players want to show off.
 */
import type { NoPicture } from "./pool-data";
import type { Lang } from "./i18n";

/** Canonical host printed on every share card, and the full clickable
 *  URL carried by the shared text. Single source of truth — callers
 *  pass APP_HOST as `appUrl` instead of spelling the domain inline. */
export const APP_HOST = "nonogram.synerworlds.com";
export const APP_URL = "https://nonogram.synerworlds.com";

const ACCENT = "#db2777";
const BG_TOP = "#2b1120";
const BG_BOT = "#170a12";
const PAPER = "#fdf2f8";

export interface ShareCardOpts {
  /** Reserved for a future position format; the card always shows
   *  the brand motif (a pixel heart on a clue grid). */
  state: string | null;
  headline: string;
  subline: string;
  appName: string;
  appUrl: string;
}

function brandFrame(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOT);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

function drawHeartMotif(ctx: CanvasRenderingContext2D, cx: number, cy: number, cell: number): void {
  const heart = [
    ".X.X.",
    "XXXXX",
    "XXXXX",
    ".XXX.",
    "..X..",
  ];
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  const gw = cell * 5;
  ctx.fillRect(cx - gw / 2 - 14, cy - gw / 2 - 14, gw + 28, gw + 28);
  heart.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch !== "X") return;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(cx - gw / 2 + c * cell + 2, cy - gw / 2 + r * cell + 2, cell - 4, cell - 4);
    });
  });
}

export function renderShareCard(opts: ShareCardOpts): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("no 2d context"));
    brandFrame(ctx, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = PAPER;
    ctx.font = "700 64px system-ui, Arial, sans-serif";
    ctx.fillText(opts.appName, W / 2, 150);

    drawHeartMotif(ctx, W / 2, 470, 92);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 58px system-ui, Arial, sans-serif";
    wrapText(ctx, opts.headline, W / 2, 830, W - 160, 68);
    ctx.fillStyle = "#f9a8d4";
    ctx.font = "500 42px system-ui, Arial, sans-serif";
    wrapText(ctx, opts.subline, W / 2, 940, W - 160, 54);

    ctx.fillStyle = ACCENT;
    ctx.font = "700 54px system-ui, Arial, sans-serif";
    ctx.fillText(opts.appUrl, W / 2, 1230);

    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("toBlob failed"));
    }, "image/png");
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = w;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${`${s}`.padStart(2, "0")}`;
}

/** The signature card: the solved COLOR picture, its title, the
 *  solve stats, and the canonical host. Shared text carries the
 *  full clickable URL (sharePng enforces it too). */
export async function sharePictureCard(
  pic: NoPicture,
  opts: { lang: Lang; seconds: number; tierName: string },
): Promise<"shared" | "downloaded"> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("no 2d context"));
    brandFrame(ctx, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = PAPER;
    ctx.font = "700 60px system-ui, Arial, sans-serif";
    ctx.fillText("Nonogram", W / 2, 130);

    // The picture, centered in a paper frame.
    const frame = 860;
    const fx = (W - frame) / 2;
    const fy = 200;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(fx - 16, fy - 16, frame + 32, frame + 32);
    const cell = frame / pic.size;
    pic.art.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        ctx.fillStyle = ch === "." ? "#f1f5f9" : pic.palette[ch] ?? ACCENT;
        ctx.fillRect(fx + c * cell + 1, fy + r * cell + 1, cell - 2, cell - 2);
      });
    });

    const title = opts.lang === "vi" ? pic.title_vi : pic.title_en;
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 56px system-ui, Arial, sans-serif";
    wrapText(ctx, `🖼️ ${title}`, W / 2, 1170, W - 140, 64);
    ctx.fillStyle = "#f9a8d4";
    ctx.font = "500 40px system-ui, Arial, sans-serif";
    ctx.fillText(
      `${pic.size}×${pic.size} · ${opts.tierName} · ⏱ ${fmtTime(opts.seconds)}`,
      W / 2,
      1245,
    );
    ctx.fillStyle = ACCENT;
    ctx.font = "700 50px system-ui, Arial, sans-serif";
    ctx.fillText(APP_HOST, W / 2, 1315);

    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("toBlob failed"));
    }, "image/png");
  });

  const title = opts.lang === "vi" ? pic.title_vi : pic.title_en;
  const text =
    opts.lang === "vi"
      ? `Tôi vừa giải xong bức tranh "${title}" trong Nonogram! Bạn thử chưa?`
      : `I just solved the picture "${title}" in Nonogram! Try it:`;
  return sharePng(blob, `Nonogram — ${title}`, text);
}

export async function sharePng(
  blob: Blob,
  title: string,
  text: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], "nonogram-card.png", { type: "image/png" });
  // The text shared alongside the image must carry the full clickable
  // URL — append it when the caller's text doesn't already contain it.
  const shareText = text.includes(APP_URL)
    ? text
    : `${text} ${APP_URL}`.trim();
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title, text: shareText, url: APP_URL });
      return "shared";
    } catch {
      /* fall through to download */
    }
  }
  // Download fallback: also copy the share text (with the URL) so the
  // link travels with the saved image.
  try {
    await navigator.clipboard?.writeText(shareText);
  } catch {
    /* clipboard unavailable */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nonogram-card.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
