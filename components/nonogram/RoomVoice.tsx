"use client";

import { STR, type Lang } from "@/lib/nonogram/i18n";
import { useRoomVoice, type VoiceMode } from "@/lib/voice/useRoomVoice";

interface Props {
  lang: Lang;
  roomId: string;
  myUserId: string;
  /**
   * Player mode: EVERY other racer in the match (Nonogram race seats
   * 2–4). Empty / unused in listener mode.
   */
  peerUserIds: string[];
  mode: VoiceMode;
}

/**
 * In-room voice chat (WebRTC, audio only, peer-to-peer).
 * Player mode: every racer talks to every other racer (one mesh link
 * per pair) + an optional consent toggle letting spectators listen.
 * Listener mode: signed-in room members spectate by ear (no
 * microphone).
 */
export function RoomVoice({ lang, roomId, myUserId, peerUserIds, mode }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const {
    status,
    joined,
    muted,
    error,
    join,
    leave,
    toggleMute,
    listenersAllowed,
    setListenersAllowed,
    listenerCount,
  } = useRoomVoice({ roomId, myUserId, peerUserIds, mode });

  const statusText =
    status === "connecting"
      ? s.voiceConnecting
      : status === "waiting"
        ? mode === "listener"
          ? s.voiceListenWaiting
          : s.voiceWaiting
        : status === "connected"
          ? mode === "listener"
            ? s.voiceListenConnected
            : s.voiceConnected
          : null;

  return (
    <div className="sud-roomvoice-block">
      <h3>
        <span>🎙️</span> <span>{String(s.voiceTitle)}</span>
      </h3>
      {!joined && (
        <button type="button" className="sud-btn small" onClick={join}>
          {mode === "listener" ? String(s.voiceListen) : String(s.voiceJoin)}
        </button>
      )}
      {joined && statusText && <p className="sud-hint">{String(statusText)}</p>}
      {joined && mode === "player" && (
        <div className="sud-comment-form">
          <button type="button" className="sud-btn small" onClick={toggleMute}>
            {muted ? `🔇 ${String(s.voiceUnmute)}` : `🎤 ${String(s.voiceMute)}`}
          </button>
          <button type="button" className="sud-btn small" onClick={leave}>
            {String(s.voiceLeave)}
          </button>
        </div>
      )}
      {joined && mode === "player" && (
        <div className="sud-comment-form">
          <button
            type="button"
            className="sud-btn small"
            onClick={() => setListenersAllowed(!listenersAllowed)}
            aria-pressed={listenersAllowed}
          >
            {listenersAllowed
              ? `🔊 ${String(s.voiceAllowListeners)} ✓`
              : `🔇 ${String(s.voiceAllowListeners)}`}
          </button>
        </div>
      )}
      {mode === "player" && listenerCount > 0 && (
        <p className="sud-hint">{String(s.voiceListenersPresent)}</p>
      )}
      {joined && mode === "listener" && (
        <div className="sud-comment-form">
          <button type="button" className="sud-btn small" onClick={leave}>
            {String(s.voiceLeave)}
          </button>
        </div>
      )}
      {error && (
        <p
          className="sud-hint"
          role="alert"
          style={{ color: "var(--danger, #c0392b)" }}
        >
          ⚠️ {error === "mic" ? String(s.voiceMicError) : String(s.voiceError)}
        </p>
      )}
    </div>
  );
}
