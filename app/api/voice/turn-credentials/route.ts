import { NextResponse } from "next/server";
import { needAuth } from "../../push/_auth";

/** Voice must degrade to STUN-only, never hard-fail. */
const STUN_ONLY = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

/**
 * GET /api/voice/turn-credentials — short-lived TURN credentials for the
 * in-room voice chat (Cloudflare Realtime TURN). Signed-in users only.
 *
 * When CLOUDFLARE_TURN_TOKEN_ID + CLOUDFLARE_TURN_API_TOKEN are unset (or
 * Cloudflare errors), this returns the two free STUN servers instead —
 * the client falls back automatically. The API token is never returned
 * or logged.
 */
export async function GET(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;

  const tokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!tokenId || !apiToken) return NextResponse.json(STUN_ONLY);

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(tokenId)}/credentials/generate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );
    if (!res.ok) return NextResponse.json(STUN_ONLY);
    const data = (await res.json()) as { iceServers?: unknown };
    if (!data || data.iceServers == null) return NextResponse.json(STUN_ONLY);
    return NextResponse.json({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
        data.iceServers,
      ],
    });
  } catch {
    return NextResponse.json(STUN_ONLY);
  }
}
