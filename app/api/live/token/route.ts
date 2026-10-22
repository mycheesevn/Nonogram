import { NextResponse } from "next/server";
import { needAuth } from "../../push/_auth";
import {
  createPublisherToken,
  liveConfig,
  liveRoomName,
} from "@/lib/live/server";

/**
 * POST /api/live/token — mint a publish-only LiveKit token + room name for
 * the signed-in user to stream their game tab. Returns 503 when the LiveKit
 * env vars are not configured, so the client can show "not enabled yet".
 */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;

  const cfg = liveConfig();
  if (!cfg)
    return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const roomName = liveRoomName(auth.uid);
  const token = await createPublisherToken(cfg, auth.uid, roomName);
  return NextResponse.json({ token, url: cfg.wsUrl, roomName });
}
