// Tiny WebAudio synth for game sounds — no audio assets needed.
// All sounds are generated: wooden knocks, clash bursts, chimes.

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem("no-muted") === "1";
} catch {
  /* storage unavailable */
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem("no-muted", m ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  freqEnd?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
}

function toneTo(dest: AudioNode, o: ToneOpts & { at?: number }) {
  const c = dest.context;
  const t = (o.at ?? c.currentTime) + (o.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + o.dur);
  g.gain.setValueAtTime(o.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

function tone(o: ToneOpts) {
  const c = ac();
  if (!c) return;
  toneTo(c.destination, { ...o, at: c.currentTime });
}

interface NoiseOpts {
  dur: number;
  gain: number;
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  delay?: number;
}

function noiseTo(dest: AudioNode, o: NoiseOpts & { at?: number }) {
  const c = dest.context;
  const t = (o.at ?? c.currentTime) + (o.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(o.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + o.dur + 0.05);
}

function noise(o: NoiseOpts) {
  const c = ac();
  if (!c) return;
  noiseTo(c.destination, { ...o, at: c.currentTime });
}

/** Soft tick when selecting a piece. */
export function playSelect(): void {
  tone({ freq: 620, dur: 0.05, gain: 0.07, type: "triangle" });
}

/** Wooden knock when a piece lands. */
export function playMove(): void {
  tone({ freq: 210, freqEnd: 95, dur: 0.09, gain: 0.5 });
  noise({ dur: 0.03, gain: 0.12, freq: 2500, type: "highpass" });
}

/** Soft whoosh when a piece starts gliding — draws the eye to the move. */
export function playMoveStart(): void {
  noise({ dur: 0.14, gain: 0.07, freq: 1400, type: "bandpass", q: 1.1 });
  tone({ freq: 280, freqEnd: 430, dur: 0.11, gain: 0.05, type: "sine" });
}

/** Dramatic clash when a piece is captured. */
export function playCapture(): void {
  tone({ freq: 130, freqEnd: 40, dur: 0.28, gain: 0.7 });
  noise({ dur: 0.32, gain: 0.4, freq: 900, q: 0.8 });
  tone({ freq: 320, freqEnd: 120, dur: 0.12, gain: 0.25, delay: 0.02 });
}



/** Bright double chime for check. */
export function playCheck(): void {
  tone({ freq: 740, dur: 0.12, gain: 0.18, type: "triangle" });
  tone({ freq: 988, dur: 0.16, gain: 0.18, type: "triangle", delay: 0.1 });
}

/** Rising arpeggio for a win. */
export function playWin(): void {
  [523, 659, 784, 1047].forEach((f, i) =>
    tone({ freq: f, dur: 0.18, gain: 0.2, type: "triangle", delay: i * 0.11 })
  );
}

/** Falling tones for a loss. */
export function playLose(): void {
  [392, 330, 262].forEach((f, i) =>
    tone({ freq: f, dur: 0.22, gain: 0.18, type: "triangle", delay: i * 0.14 })
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled synth variants for video export. `at` is an absolute     */
/* time on the destination's context (defaults to now). Same voices   */
/* as the in-game sounds, scheduled on the export timeline.           */
/* ------------------------------------------------------------------ */

/** Wooden knock when a piece lands. */
export function synthMove(dest: AudioNode, at?: number): void {
  toneTo(dest, { freq: 210, freqEnd: 95, dur: 0.09, gain: 0.5, at });
  noiseTo(dest, { dur: 0.03, gain: 0.12, freq: 2500, type: "highpass", at });
}

/** Soft whoosh when a piece starts gliding. */
export function synthMoveStart(dest: AudioNode, at?: number): void {
  noiseTo(dest, { dur: 0.14, gain: 0.07, freq: 1400, type: "bandpass", q: 1.1, at });
  toneTo(dest, { freq: 280, freqEnd: 430, dur: 0.11, gain: 0.05, type: "sine", at });
}

/** Dramatic clash when a piece is captured. */
export function synthCapture(dest: AudioNode, at?: number): void {
  toneTo(dest, { freq: 130, freqEnd: 40, dur: 0.28, gain: 0.7, at });
  noiseTo(dest, { dur: 0.32, gain: 0.4, freq: 900, q: 0.8, at });
  toneTo(dest, { freq: 320, freqEnd: 120, dur: 0.12, gain: 0.25, delay: 0.02, at });
}

/** Bright double chime for check. */
export function synthCheck(dest: AudioNode, at?: number): void {
  toneTo(dest, { freq: 740, dur: 0.12, gain: 0.18, type: "triangle", at });
  toneTo(dest, { freq: 988, dur: 0.16, gain: 0.18, type: "triangle", delay: 0.1, at });
}
