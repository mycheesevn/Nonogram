import { NextResponse } from "next/server";
import { needAuth } from "../../push/_auth";
import {
  liveConfig,
  roomBelongsTo,
  rtmpUrlFor,
  startStreamEgress,
  type LivePlatform,
} from "@/lib/live/server";

/**
 * POST /api/live/start — start RTMP egress of the caller's published game
 * tab to their own YouTube/Facebook stream keys.
 *
 * Body: { roomName, destinations: [{ platform: "youtube"|"facebook", key }] }
 * Stream keys are used transiently to compose the ingest URLs — they are
 * never stored or logged. Error responses never echo key material.
 */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;

  const cfg = liveConfig();
  if (!cfg)
    return NextResponse.json({ error: "not_configured" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { roomName, destinations } = (body ?? {}) as {
    roomName?: unknown;
    destinations?: unknown;
  };
  if (typeof roomName !== "string" || !roomBelongsTo(roomName, auth.uid))
    return NextResponse.json({ error: "bad_room" }, { status: 400 });
  if (!Array.isArray(destinations) || destinations.length === 0)
    return NextResponse.json({ error: "no_destination" }, { status: 400 });

  const urls: string[] = [];
  for (const d of destinations) {
    const { platform, key } = (d ?? {}) as {
      platform?: unknown;
      key?: unknown;
    };
    if (
      (platform !== "youtube" && platform !== "facebook") ||
      typeof key !== "string"
    )
      return NextResponse.json({ error: "bad_destination" }, { status: 400 });
    const url = rtmpUrlFor(platform as LivePlatform, key.trim());
    if (!url)
      return NextResponse.json({ error: "bad_key" }, { status: 400 });
    urls.push(url);
  }

  try {
    const { egressId } = await startStreamEgress(cfg, roomName, auth.uid, urls);
    return NextResponse.json({ egressId });
  } catch (e) {
    console.error("live egress start failed", e instanceof Error ? e.name : e);
    return NextResponse.json({ error: "egress_failed" }, { status: 502 });
  }
}
