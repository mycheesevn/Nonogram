// Minimal canvas confetti — no dependencies. Fires a burst of paper
// rectangles from near the top-center of the screen, then cleans up.
// Ported from PacClone (lib/xiangqi/confetti.ts) via Chess, with Ô Ăn
// Quan's earth/amber palette. Fired when a game ends and the viewer is
// the winner (family pattern — see the boardgame-engagement skill,
// references/excitement.md).

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
}

const COLORS = ["#2563eb", "#b45309", "#e8a33d", "#f3e2bb", "#4a6fa5"];

export function burstConfetti(opts?: {
  count?: number;
  durationMs?: number;
}): void {
  if (typeof document === "undefined") return;
  const count = opts?.count ?? 90;
  const durationMs = opts?.durationMs ?? 2600;
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  const parts: Particle[] = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 140,
      y: window.innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 11,
      vy: -Math.random() * 9 - 3,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }

  const t0 = performance.now();
  const tick = (t: number) => {
    const el = t - t0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const fade =
      el > durationMs - 600 ? 1 - (el - (durationMs - 600)) / 600 : 1;
    ctx.globalAlpha = Math.max(0, fade);
    for (const p of parts) {
      p.vy += 0.22;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.restore();
    if (el < durationMs) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(tick);
}
