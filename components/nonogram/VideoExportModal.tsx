"use client";

import { useEffect, useRef, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  exportNoReplayVideo,
  type NoReplayVideoInput,
} from "@/lib/nonogram/replayVideo";
import { APP_URL } from "@/lib/nonogram/shareCard";

const CANONICAL_SHARE_ORIGIN = APP_URL;

/**
 * Build the share URL on the canonical host, preserving any deep-link
 * path/query/hash already present on `raw` (e.g. `/?room=CODE`).
 * Mirrors the image-share pattern in lib/nonogram/shareCard.ts, which
 * always shares `https://nonogram.synerworlds.com` — never the runtime
 * origin (which may be a vercel.app / dev origin).
 */
function canonicalShareUrl(raw?: string): string {
  if (!raw) return CANONICAL_SHARE_ORIGIN;
  try {
    const parsed = new URL(raw, CANONICAL_SHARE_ORIGIN);
    const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return suffix === "/" ? CANONICAL_SHARE_ORIGIN : `${CANONICAL_SHARE_ORIGIN}${suffix}`;
  } catch {
    return raw.startsWith("/")
      ? `${CANONICAL_SHARE_ORIGIN}${raw === "/" ? "" : raw}`
      : CANONICAL_SHARE_ORIGIN;
  }
}

export interface NoVideoGame {
  /** Pool picture id of the recorded game. */
  pictureId: string;
  /** Semicolon-joined move log (flow.ts encodeLog format). */
  moves: string;
  /** Whether the recorded game was a win (drives the color-reveal
   *  celebration segment). Derived from the log when omitted. */
  won?: boolean;
  title: string;
  subtitle: string;
  shareUrl?: string;
}

/**
 * Name kept as SudVideoGame (mirrors the sibling games) — HistoryView
 * imports this exact type name.
 */
export type SudVideoGame = NoVideoGame;

interface Props {
  lang: Lang;
  game: SudVideoGame | null;
  onClose: () => void;
}

type Phase = "ready" | "recording" | "done" | "error";

/** Export a game replay as a shareable video clip (MP4 on Safari, WebM on Chrome).
 *  Family timeline (kept from the sibling games): 2.0s intro card WITH the
 *  site URL → moves → win moment (color picture reveal) → 2.2s
 *  celebration → 2.0s outro card with the URL. The host printed on both
 *  cards is the canonical APP_HOST consumed inside
 *  lib/nonogram/replayVideo.ts.
 */
export function VideoExportModal({ lang, game, onClose }: Props) {
  const s = STR[lang] as Record<string, string>;
  const [phase, setPhase] = useState<Phase>("ready");
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopMic = () => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  };

  const toggleMic = async () => {
    if (micOn) {
      stopMic();
      setMicOn(false);
      setMicError(false);
      return;
    }
    setMicError(false);
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;
      setMicOn(true);
    } catch {
      setMicError(true);
    }
  };

  useEffect(() => {
    if (game) {
      setPhase("ready");
      setProgress(0);
      setVideoUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setFile(null);
    } else {
      abortRef.current?.abort();
      stopMic();
      setMicOn(false);
      setMicError(false);
    }
  }, [game]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopMic();
      setVideoUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, []);

  if (!game) return null;

  const startRecording = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("recording");
    setProgress(0);
    try {
      const input: NoReplayVideoInput = {
        pictureId: game.pictureId,
        moves: game.moves,
        won: game.won,
        title: game.title,
        subtitle: game.subtitle,
        lang,
        speed,
        micStream: micStreamRef.current,
        signal: ctrl.signal,
        onProgress: (p) => setProgress(p),
      };
      const f = await exportNoReplayVideo(input);
      setFile(f);
      setVideoUrl(URL.createObjectURL(f));
      setPhase("done");
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") {
        setPhase("ready");
        setProgress(0);
      } else {
        setPhase("error");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const shareFile = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const url = canonicalShareUrl(game.shareUrl);
      const baseText = `${game.title}\n${game.subtitle}`;
      const shareText = baseText.includes(url) ? baseText : `${baseText}\n${url}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: game.title,
          text: shareText,
          url,
        });
      } else {
        downloadFile();
        try {
          await navigator.clipboard.writeText(
            `${game.title} ${game.subtitle} ${url}`
          );
        } catch {
          /* clipboard unavailable */
        }
      }
    } catch {
      /* share cancelled */
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = () => {
    if (!videoUrl || !file) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="sud-modal-root" onClick={onClose}>
      <div className="sud-modal" onClick={(e) => e.stopPropagation()}>
        <h2>🎬 {s.replayExport}</h2>
        {phase === "ready" && (
          <>
            <p className="sud-empty-note">{s.replayExportDesc}</p>
            <p className="sud-empty-note">
              {s.replayMovesCount.replace(
                "{n}",
                String(game.moves ? game.moves.split(";").filter(Boolean).length : 0),
              )}
            </p>
            <div className="sud-video-row">
              <span className="sud-video-label">{s.replaySpeed}</span>
              <div className="sud-seg" role="group" aria-label={s.replaySpeed}>
                {(
                  [
                    { v: 0.5, label: s.replaySpeedSlow },
                    { v: 1, label: s.replaySpeedNormal },
                    { v: 1.5, label: s.replaySpeedFast },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={speed === o.v ? "active" : ""}
                    onClick={() => setSpeed(o.v)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="sud-video-mic">
              <input type="checkbox" checked={micOn} onChange={toggleMic} />
              <span>{s.replayMic}</span>
            </label>
            {micError && <p className="sud-error">{s.replayMicDenied}</p>}
            <div className="sud-modal-actions">
              <button
                type="button"
                className="sud-btn sud-btn-primary"
                onClick={startRecording}
              >
                ● {s.replayStart}
              </button>
              <button
                type="button"
                className="sud-btn small"
                onClick={onClose}
              >
                {s.replayClose}
              </button>
            </div>
          </>
        )}
        {phase === "recording" && (
          <>
            <p className="sud-empty-note">{s.replayRecording}</p>
            <div className="sud-progress">
              <div
                className="sud-progress-fill"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="sud-empty-note">{Math.round(progress * 100)}%</p>
            <div className="sud-modal-actions">
              <button
                type="button"
                className="sud-btn small"
                onClick={() => abortRef.current?.abort()}
              >
                {s.replayCancel}
              </button>
            </div>
          </>
        )}
        {phase === "done" && videoUrl && (
          <>
            <p className="sud-empty-note">{s.replayDone}</p>
            <video
              className="sud-video-preview"
              src={videoUrl}
              controls
              playsInline
            />
            <div className="sud-modal-actions">
              <button
                type="button"
                className="sud-btn sud-btn-primary"
                disabled={busy}
                onClick={shareFile}
              >
                📤 {s.replayShare}
              </button>
              <button
                type="button"
                className="sud-btn small"
                onClick={downloadFile}
              >
                ⬇️ {s.replayDownload}
              </button>
              <button type="button" className="sud-btn small" onClick={onClose}>
                {s.replayClose}
              </button>
            </div>
          </>
        )}
        {phase === "error" && (
          <>
            <p className="sud-error">{s.replayError}</p>
            <div className="sud-modal-actions">
              <button type="button" className="sud-btn small" onClick={onClose}>
                {s.replayClose}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
