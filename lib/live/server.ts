import {
  AccessToken,
  EgressClient,
  EncodingOptionsPreset,
  StreamOutput,
  StreamProtocol,
} from "livekit-server-sdk";

/**
 * Server-side LiveKit helpers for the "Go Live" feature (stream a game
 * to the player's own YouTube/Facebook channel).
 *
 * The browser publishes its game tab as a screenshare track to a LiveKit
 * Cloud room; Participant Egress then transcodes that track and pushes it
 * out over RTMP to the player's stream keys. All media handling lives on
 * LiveKit Cloud — this app only mints tokens and starts/stops egress.
 *
 * Env-gated: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
 * When unset, the feature reports "not configured" and the UI degrades
 * gracefully (same pattern as the TURN credentials route).
 */

export interface LiveConfig {
  /** wss:// URL handed to browsers. */
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
}

export function liveConfig(): LiveConfig | null {
  const wsUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!wsUrl || !apiKey || !apiSecret) return null;
  return { wsUrl, apiKey, apiSecret };
}

function egressClient(cfg: LiveConfig): EgressClient {
  // The egress/admin API speaks HTTPS; the configured URL is the wss:// one.
  const httpUrl = cfg.wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");
  return new EgressClient(httpUrl, cfg.apiKey, cfg.apiSecret);
}

/** Room names embed the owner uid so /start can verify ownership cheaply. */
export function liveRoomName(uid: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `nonogram-live-${uid}-${Date.now().toString(36)}${rand}`;
}

export function roomBelongsTo(roomName: string, uid: string): boolean {
  return roomName.startsWith(`nonogram-live-${uid}-`);
}

export async function createPublisherToken(
  cfg: LiveConfig,
  uid: string,
  roomName: string
): Promise<string> {
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: uid,
    ttl: "2h",
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: false,
  });
  return at.toJwt();
}

export type LivePlatform = "youtube" | "facebook";

const KEY_RE = /^[A-Za-z0-9_-]{6,200}$/;

/**
 * Compose the platform RTMP ingest URL from a bare stream key. URLs are
 * built ONLY here, from a fixed per-platform template — the client never
 * supplies a URL, so egress can't be pointed at arbitrary destinations.
 */
export function rtmpUrlFor(platform: LivePlatform, key: string): string | null {
  if (!KEY_RE.test(key)) return null;
  if (platform === "youtube") return `rtmp://a.rtmp.youtube.com/live2/${key}`;
  if (platform === "facebook")
    return `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;
  return null;
}

export async function startStreamEgress(
  cfg: LiveConfig,
  roomName: string,
  uid: string,
  urls: string[]
): Promise<{ egressId: string }> {
  const egress = egressClient(cfg);
  const output = {
    stream: new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls,
    }),
  };
  const info = await egress.startParticipantEgress(roomName, uid, output, {
    screenShare: true,
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
  });
  return { egressId: info.egressId };
}

export async function stopStreamEgress(
  cfg: LiveConfig,
  egressId: string
): Promise<void> {
  const egress = egressClient(cfg);
  await egress.stopEgress(egressId);
}
