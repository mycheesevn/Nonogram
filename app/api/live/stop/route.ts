import { NextResponse } from "next/server";
import { needAuth } from "../../push/_auth";
import { liveConfig, stopStreamEgress } from "@/lib/live/server";

/**
 * POST /api/live/stop — stop a running stream egress.
 * Body: { egressId }. Egress ids are unguessable; the egress also ends on
 * its own when the publisher leaves the room, so this is a fast-path stop.
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
  const { egressId } = (body ?? {}) as { egressId?: unknown };
  if (typeof egressId !== "string" || !/^EG_[A-Za-z0-9]+$/.test(egressId))
    return NextResponse.json({ error: "bad_egress" }, { status: 400 });

  try {
    await stopStreamEgress(cfg, egressId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("live egress stop failed", e instanceof Error ? e.name : e);
    return NextResponse.json({ error: "egress_failed" }, { status: 502 });
  }
}
