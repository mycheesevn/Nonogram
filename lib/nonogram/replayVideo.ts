/** Replay video export (canvas + MediaRecorder).
 *  Family timeline: exactly 2.0s intro card (app name + NONOGRAM +
 *  canonical host nonogram.synerworlds.com) → the moves play back
 *  compressed (clue gutters drawn, mistakes flash red) → for a WON
 *  game the win moment: the picture revealed in COLOR + a 2.2s
 *  celebration (banner + deterministic confetti, no card overlay)
 *  → exactly 2.0s outro card with the host again. */
import { STR, type Lang } from "./i18n";
import { buildReplay, type ReplayStep } from "./replay";
import { pictureBitmap, pictureClues, type NoPicture } from "./pool";
import { APP_HOST } from "./shareCard";
import { synthCapture, synthCheck, synthMove } from "./sound";
import type { CellState } from "./flow";

export interface NoReplayVideoInput {
  /** Pool picture id of the recorded game. */
  pictureId: string;
  /** Semicolon-joined move log (flow.ts encodeLog format). */
  moves: string;
  title: string;
  subtitle: string;
  /** Whether the recorded game was a win; derived from the final
   *  frame when omitted. */
  won?: boolean;
  lang: Lang;
  speed: number;
  micStream: MediaStream | null;
  signal: AbortSignal;
  onProgress: (p: number) => void;
}

/** Legacy names kept for the shared modal's shape (family convention). */
export type SudReplayVideoInput = NoReplayVideoInput & {
  labels?: string[];
  startPos?: string;
  startTurn?: string | number;
};

const W = 900;
const H = 1240;
const BOARD_Y = 170;
const BOARD_H = 900;
const ACCENT = "#db2777";
const INK = "#170a12";
const PAPER = "#fdf2f8";

interface Geom {
  cell: number;
  clue: number;
  ox: number;
  oy: number;
  rowDepth: number;
  colDepth: number;
}

function geometry(size: number, rowDepth: number, colDepth: number): Geom {
  const avail = 840;
  const clueRatio = 0.55;
  const cell = Math.floor(
    Math.min(
      avail / (size + rowDepth * clueRatio),
      avail / (size + colDepth * clueRatio),
    ),
  );
  const clue = cell * clueRatio;
  const totalW = rowDepth * clue + size * cell;
  const totalH = colDepth * clue + size * cell;
  return {
    cell,
    clue,
    ox: (W - totalW) / 2,
    oy: BOARD_Y + (BOARD_H - totalH) / 2,
    rowDepth,
    colDepth,
  };
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  picture: NoPicture,
  cells: CellState[][],
  opts: { revealed?: boolean; flash?: ReplayStep | null } = {},
): void {
  const size = picture.size;
  const { rows: rowClues, cols: colClues } = pictureClues(picture);
  const rowDepth = Math.max(1, ...rowClues.map((c) => c.length));
  const colDepth = Math.max(1, ...colClues.map((c) => c.length));
  const flash = opts.flash ?? null;
  const g = geometry(size, rowDepth, colDepth);
  const gx = g.ox + g.rowDepth * g.clue;
  const gy = g.oy + g.colDepth * g.clue;

  // Paper + clue gutters.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(g.ox - 10, g.oy - 10, size * g.cell + g.rowDepth * g.clue + 20, size * g.cell + g.colDepth * g.clue + 20);
  ctx.fillStyle = PAPER;
  ctx.fillRect(g.ox, g.oy, gx - g.ox, size * g.cell + (gy - g.oy));
  ctx.fillRect(gx, g.oy, size * g.cell, gy - g.oy);

  // Cells.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = gx + c * g.cell;
      const y = gy + r * g.cell;
      if (opts.revealed) {
        const ch = picture.art[r]?.[c] ?? ".";
        ctx.fillStyle = ch === "." ? "#f1f5f9" : picture.palette[ch] ?? ACCENT;
        ctx.fillRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
        continue;
      }
      const v = cells[r]?.[c] ?? 0;
      const isFlash = !!flash && flash.r === r && flash.c === c;
      ctx.fillStyle = isFlash
        ? flash.mistake
          ? "#fecaca"
          : "#fbcfe8"
        : v === 1
          ? ACCENT
          : "#ffffff";
      ctx.fillRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
      if (v === 2) {
        const pad = g.cell * 0.26;
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = Math.max(2, g.cell * 0.09);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x + pad, y + pad);
        ctx.lineTo(x + g.cell - pad, y + g.cell - pad);
        ctx.moveTo(x + g.cell - pad, y + pad);
        ctx.lineTo(x + pad, y + g.cell - pad);
        ctx.stroke();
      }
      if (isFlash && flash.mistake) {
        ctx.fillStyle = "rgba(220, 38, 38, 0.55)";
        ctx.fillRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
      }
    }
  }

  // Grid lines: thin, bold every 5, outer border.
  for (let k = 0; k <= size; k++) {
    ctx.strokeStyle = k % 5 === 0 ? "#64748b" : "#e2e8f0";
    ctx.lineWidth = k % 5 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(gx + k * g.cell, gy);
    ctx.lineTo(gx + k * g.cell, gy + size * g.cell);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx, gy + k * g.cell);
    ctx.lineTo(gx + size * g.cell, gy + k * g.cell);
    ctx.stroke();
  }
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 4;
  ctx.strokeRect(gx, gy, size * g.cell, size * g.cell);

  if (opts.revealed) return;
  // Clues: rows right-aligned in the left gutter, cols bottom-aligned
  // in the top gutter (same layout as components/nonogram/Board.tsx).
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(g.clue * 0.72)}px system-ui, sans-serif`;
  ctx.fillStyle = "#334155";
  rowClues.forEach((clue, r) => {
    clue.forEach((n, i) => {
      ctx.fillText(
        String(n),
        gx - (clue.length - 1 - i) * g.clue - g.clue / 2,
        gy + r * g.cell + g.cell / 2,
      );
    });
  });
  colClues.forEach((clue, c) => {
    clue.forEach((n, i) => {
      ctx.fillText(
        String(n),
        gx + c * g.cell + g.cell / 2,
        gy - (clue.length - 1 - i) * g.clue - g.clue / 2,
      );
    });
  });
}

function drawChrome(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, BOARD_Y);
  ctx.fillRect(0, BOARD_Y + BOARD_H, W, H - BOARD_Y - BOARD_H);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 54px system-ui, sans-serif";
  ctx.fillText("🖼️ Nonogram", W / 2, 62);
  ctx.font = "400 34px system-ui, sans-serif";
  ctx.fillStyle = "#f9a8d4";
  const sub = subtitle ? `${title} · ${subtitle}` : title;
  ctx.fillText(sub.slice(0, 44), W / 2, 122);
  ctx.font = "700 38px system-ui, sans-serif";
  ctx.fillStyle = ACCENT;
  ctx.fillText(APP_HOST, W / 2, BOARD_Y + BOARD_H + 82);
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  outro: boolean,
): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "110px system-ui, sans-serif";
  ctx.fillText("🖼️", W / 2, 400);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 84px system-ui, sans-serif";
  ctx.fillText("NONOGRAM", W / 2, 540);
  ctx.font = "400 40px system-ui, sans-serif";
  ctx.fillStyle = "#f9a8d4";
  if (outro) {
    if (title) ctx.fillText(title.slice(0, 40), W / 2, 650);
  } else {
    ctx.fillText(title.slice(0, 40), W / 2, 650);
    if (subtitle) ctx.fillText(subtitle.slice(0, 44), W / 2, 712);
  }
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillStyle = ACCENT;
  ctx.fillText(APP_HOST, W / 2, 900);
}

/** Deterministic confetti (seeded by particle index — same clip,
 *  same confetti, family convention). */
function drawConfetti(ctx: CanvasRenderingContext2D, t: number): void {
  const colors = ["#db2777", "#dc2626", "#eab308", "#16a34a", "#2563eb"];
  for (let i = 0; i < 90; i++) {
    const seed = i * 7919;
    const x = ((seed * 37) % 900) + Math.sin(t * 2 + i) * 22;
    const fall = ((seed % 500) + t * (260 + (seed % 180))) % (H + 80);
    const y = fall - 40;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 3 + i);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-9, -6, 18, 12);
    ctx.restore();
  }
}

function finalIsWin(picture: NoPicture, cells: CellState[][]): boolean {
  const bitmap = pictureBitmap(picture);
  for (let r = 0; r < picture.size; r++) {
    for (let c = 0; c < picture.size; c++) {
      if ((cells[r][c] === 1) !== bitmap[r][c]) return false;
    }
  }
  return true;
}

export async function exportNoReplayVideo(input: NoReplayVideoInput): Promise<File> {
  const s = STR[input.lang] as Record<string, string>;
  const replay = buildReplay({ pictureId: input.pictureId, moves: input.moves });
  if (!replay) throw new Error("unknown picture");
  const { picture, frames, steps } = replay;
  const final = frames[frames.length - 1];
  const won = input.won ?? finalIsWin(picture, final);
  const decisive = won && steps.length > 0;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  // Audio: synth sounds + optional mic mixed into one destination.
  const audioCtx = new AudioContext();
  const audioDest = audioCtx.createMediaStreamDestination();
  if (input.micStream) {
    const src = audioCtx.createMediaStreamSource(input.micStream);
    src.connect(audioDest);
  }

  const stream = canvas.captureStream(30);
  for (const track of audioDest.stream.getAudioTracks()) stream.addTrack(track);
  const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("MediaRecorder unsupported");
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const INTRO = 2.0;
  const OUTRO = 2.0;
  const CELEB = decisive ? 2.2 : 0;
  // Compressed playback: ~0.45s/step at 1×, capped so even a long
  // 15×15 solve stays a shareable clip.
  const perStep =
    steps.length > 0
      ? Math.min(0.45 / Math.max(0.25, input.speed), 40 / steps.length)
      : 0;
  const movesDur = steps.length * perStep;
  const total = INTRO + movesDur + CELEB + OUTRO;

  // Schedule synth sounds on the export timeline (thinned out on
  // very long logs so we don't spawn thousands of oscillators).
  const t0ctx = audioCtx.currentTime + 0.05;
  const stride = Math.max(1, Math.ceil(steps.length / 180));
  steps.forEach((p, i) => {
    if (i % stride !== 0 && !p.mistake) return;
    const at = t0ctx + INTRO + i * perStep;
    if (p.mistake) synthCapture(audioDest, at);
    else synthMove(audioDest, at);
  });
  if (decisive) synthCheck(audioDest, t0ctx + INTRO + movesDur + 0.1);

  recorder.start(250);
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (input.signal.aborted) {
        reject(new Error("cancelled"));
        return;
      }
      const t = (performance.now() - start) / 1000;
      input.onProgress(Math.min(1, t / total));
      if (t < INTRO) {
        drawCard(ctx, input.title, input.subtitle, false);
      } else if (t < INTRO + movesDur) {
        const idx = Math.min(steps.length, Math.floor((t - INTRO) / perStep));
        drawChrome(ctx, input.title, input.subtitle);
        drawBoard(ctx, picture, frames[idx], {
          flash: idx > 0 ? steps[idx - 1] : null,
        });
      } else if (t < INTRO + movesDur + CELEB) {
        drawChrome(ctx, input.title, input.subtitle);
        // Win moment: the finished picture revealed in COLOR.
        drawBoard(ctx, picture, final, { revealed: true });
        ctx.fillStyle = "rgba(23, 10, 18, 0.82)";
        ctx.fillRect(90, BOARD_Y + 380, W - 180, 130);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 58px system-ui, sans-serif";
        ctx.fillText(`🎉 ${String(s.sudSolved ?? "Solved!")}`, W / 2, BOARD_Y + 445);
        drawConfetti(ctx, t - INTRO - movesDur);
      } else if (t < total) {
        drawCard(ctx, String(s.replayOutro ?? ""), "", true);
      } else {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch(async (e) => {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
    await audioCtx.close().catch(() => {});
    throw e;
  });

  recorder.stop();
  await stopped;
  await audioCtx.close().catch(() => {});
  const blob = new Blob(chunks, { type: mime });
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  return new File([blob], `nonogram-replay-${Date.now()}.${ext}`, { type: mime });
}

/** Legacy export name (the Sudoku-cloned modal's original import). */
export const exportSudReplayVideo = exportNoReplayVideo;
