import { Room, Track } from "livekit-client";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Browser side of the "Go Live" feature: capture this game tab with
 * getDisplayMedia, publish it to a LiveKit Cloud room, then ask our API to
 * start RTMP egress to the player's own YouTube/Facebook stream keys.
 */

export type LivePlatform = "youtube" | "facebook";
export interface LiveDestination {
  platform: LivePlatform;
  key: string;
}

export class LiveError extends Error {
  code: string;
  /** Extra machine-readable reason, e.g. the DOMException name from
   *  getDisplayMedia — kept so the UI can explain a failure instead of
   *  silently resetting. */
  detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function liveCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

async function accessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token ?? null;
}

async function apiPost(
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

const LS_KEYS = "sud-live-keys";

export function loadSavedKeys(): { youtube: string; facebook: string } {
  try {
    const raw = localStorage.getItem(LS_KEYS);
    if (!raw) return { youtube: "", facebook: "" };
    const parsed = JSON.parse(raw) as { youtube?: unknown; facebook?: unknown };
    return {
      youtube: typeof parsed.youtube === "string" ? parsed.youtube : "",
      facebook: typeof parsed.facebook === "string" ? parsed.facebook : "",
    };
  } catch {
    return { youtube: "", facebook: "" };
  }
}

export function storeSavedKeys(keys: { youtube: string; facebook: string }): void {
  try {
    localStorage.setItem(LS_KEYS, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}

export function clearSavedKeys(): void {
  try {
    localStorage.removeItem(LS_KEYS);
  } catch {
    /* storage unavailable */
  }
}

export class LiveBroadcaster {
  private room: Room | null = null;
  private mediaTrack: MediaStreamTrack | null = null;
  private egressId: string | null = null;
  /** Fires when the user ends tab sharing from the browser's own UI. */
  onShareEnded: (() => void) | null = null;

  get streaming(): boolean {
    return this.egressId !== null;
  }

  async start(destinations: LiveDestination[]): Promise<void> {
    const token = await accessToken();
    if (!token) throw new LiveError("unauthorized");

    const mint = await apiPost("/api/live/token", token);
    if (mint.status === 503) throw new LiveError("not_configured");
    if (mint.status === 401) throw new LiveError("unauthorized");
    if (mint.status !== 200) throw new LiveError("failed");
    const { url, roomName } = mint.json as { url: string; roomName: string };
    const lkToken = mint.json.token as string;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        // Tab audio (game sounds) when a TAB is shared; window/screen
        // shares simply yield no audio track. Some ingest endpoints are
        // picky about video-only streams, so carry audio when offered.
        audio: true,
        // Chrome EXCLUDES the calling tab from the picker by default — the
        // player would never see the game tab itself. Opt it back in.
        selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions);
    } catch (e) {
      // The tab picker was dismissed, or the browser refused to show it at
      // all (permission/policy block, missing screen-capture right, or an
      // automated/headless environment). Keep the browser's own reason so
      // the modal can explain the failure instead of silently resetting.
      const name = e instanceof DOMException ? e.name : "unknown";
      throw new LiveError("capture", name);
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new LiveError("failed");
    }
    this.mediaTrack = track;

    try {
      const room = new Room();
      this.room = room;
      await room.connect(url, lkToken);
      await room.localParticipant.publishTrack(track, {
        name: "board",
        source: Track.Source.ScreenShare,
        videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
        simulcast: false,
      });
      // Best-effort: publish the tab's audio alongside (game sound
      // effects). Never let an audio hiccup kill the video stream.
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        try {
          await room.localParticipant.publishTrack(audioTrack, {
            name: "board-audio",
            source: Track.Source.ScreenShareAudio,
          });
        } catch {
          /* video-only stream still works */
        }
      }
      track.addEventListener("ended", () => {
        void this.stop().finally(() => this.onShareEnded?.());
      });

      const started = await apiPost("/api/live/start", token, {
        roomName,
        destinations,
      });
      if (started.status === 503) throw new LiveError("not_configured");
      if (started.status !== 200) throw new LiveError("failed");
      this.egressId = started.json.egressId as string;
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  async stop(): Promise<void> {
    const egressId = this.egressId;
    this.egressId = null;
    if (egressId) {
      try {
        const token = await accessToken();
        if (token) await apiPost("/api/live/stop", token, { egressId });
      } catch {
        /* egress also ends when the publisher leaves the room */
      }
    }
    try {
      await this.room?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.room = null;
    try {
      this.mediaTrack?.stop();
    } catch {
      /* already ended */
    }
    this.mediaTrack = null;
  }
}
