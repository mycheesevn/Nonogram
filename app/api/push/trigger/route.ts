import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { needAuth } from "../_auth";
import { sendPushToUser } from "@/lib/push/server";

/**
 * Event-verified push triggers. The caller's client invokes these right after
 * performing the action; the server re-checks the real DB state before sending
 * anything, so a client cannot spam arbitrary users.
 *
 * kinds:
 *  - { kind: "challenge", challengeId } — notify the challenged player.
 *  - { kind: "challenge_declined", challengeId } — notify the challenger of a decline.
 * Races have no turns and Nonogram has no correspondence mode, so
 * there are no turn/corr kinds — challenges are the only triggers.
 */

// Simple in-memory throttle: key -> last sent timestamp (ms).
const lastSent = new Map<string, number>();
function throttled(key: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < minIntervalMs) return true;
  lastSent.set(key, now);
  return false;
}

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("push_not_configured");
  return createClient(url, serviceKey);
}

function displayName(p: { full_name?: string | null; username?: string | null } | null): string {
  if (!p) return "Người chơi";
  return p.full_name || p.username || "Người chơi";
}

/**
 * Persist the event to the in-app notification inbox so the user can review
 * it later even if the push was missed/dismissed. Fire-and-forget: a failure
 * here must never break the push itself.
 */
async function recordNotification(
  sb: ReturnType<typeof service>,
  n: {
    user_id: string;
    kind: string;
    title: string;
    body: string;
    url: string;
    ref_id?: string;
  }
): Promise<void> {
  try {
    // De-dupe: don't stack identical unread rows for the same event.
    let q = sb
      .from("no_notifications")
      .select("id")
      .eq("user_id", n.user_id)
      .eq("kind", n.kind)
      .is("read_at", null)
      .limit(1);
    q = n.ref_id ? q.eq("ref_id", n.ref_id) : q.is("ref_id", null);
    const { data: existing } = await q;
    if (existing && existing.length > 0) return;
    await sb.from("no_notifications").insert({
      user_id: n.user_id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url,
      ref_id: n.ref_id ?? null,
    });
  } catch {
    /* inbox is best-effort */
  }
}

export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const { uid } = auth;

  let body: { kind?: string; challengeId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    if (body.kind === "challenge" && body.challengeId) {
      return await onChallenge(uid, body.challengeId);
    }
    if (body.kind === "challenge_declined" && body.challengeId) {
      return await onChallengeDeclined(uid, body.challengeId);
    }
    if (body.kind === "challenge_accepted" && body.challengeId) {
      return await onChallengeAccepted(uid, body.challengeId);
    }
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    const status = msg === "push_not_configured" ? 500 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

async function onChallenge(challengerId: string, challengeId: string) {
  const sb = service();
  const { data: ch, error } = await sb
    .from("no_challenges")
    .select("id, challenger_id, challenged_id, status, room_id, created_at")
    .eq("id", challengeId)
    .single();
  if (error || !ch) throw new Error("not_found");
  // Only the real challenger can trigger, only for fresh pending challenges.
  if (ch.challenger_id !== challengerId) throw new Error("forbidden");
  if (ch.status !== "pending") throw new Error("not_pending");
  if (throttled(`challenge:${challengeId}`, 5 * 60 * 1000)) {
    return NextResponse.json({ ok: true, skipped: "throttled" });
  }
  if (Date.now() - new Date(ch.created_at).getTime() > 10 * 60 * 1000) {
    throw new Error("stale");
  }
  const { data: me } = await sb
    .from("profiles")
    .select("full_name, username")
    .eq("id", challengerId)
    .single();
  const name = displayName(me);
  // Deep-link to the challenge itself (the app opens the Friends view).
  const url = `/?challenge=${ch.id}`;
  const { sent } = await sendPushToUser(ch.challenged_id, {
    title: "⚔️ Lời thách đấu!",
    body: `${name} vừa thách đấu bạn một ván cờ.`,
    url,
    tag: `challenge-${ch.id}`,
  });
  await recordNotification(sb, {
    user_id: ch.challenged_id,
    kind: "challenge",
    title: "⚔️ Lời thách đấu!",
    body: `${name} vừa thách đấu bạn một ván cờ.`,
    url,
    ref_id: ch.id,
  });
  return NextResponse.json({ ok: true, sent });
}

async function onChallengeDeclined(declinerId: string, challengeId: string) {
  const sb = service();
  const { data: ch, error } = await sb
    .from("no_challenges")
    .select("id, challenger_id, challenged_id, status")
    .eq("id", challengeId)
    .single();
  if (error || !ch) throw new Error("not_found");
  // Only the challenged player can report a decline, and only once.
  if (ch.challenged_id !== declinerId) throw new Error("forbidden");
  if (throttled(`challenge_declined:${challengeId}`, 5 * 60 * 1000)) {
    return NextResponse.json({ ok: true, skipped: "throttled" });
  }
  if (ch.status !== "declined") throw new Error("not_declined");
  const { data: me } = await sb
    .from("profiles")
    .select("full_name, username")
    .eq("id", declinerId)
    .single();
  const name = displayName(me);
  const body = `${name} đã từ chối lời thách đấu của bạn.`;
  // No deep link: the challenge is over, just open the app.
  const { sent } = await sendPushToUser(ch.challenger_id, {
    title: "😞 Thách đấu bị từ chối",
    body,
    url: "/",
    tag: `challenge-declined-${ch.id}`,
  });
  await recordNotification(sb, {
    user_id: ch.challenger_id,
    kind: "challenge_declined",
    title: "😞 Thách đấu bị từ chối",
    body,
    url: "/",
    ref_id: ch.id,
  });
  return NextResponse.json({ ok: true, sent });
}

async function onChallengeAccepted(accepterId: string, challengeId: string) {
  const sb = service();
  const { data: ch, error } = await sb
    .from("no_challenges")
    .select("id, challenger_id, challenged_id, status, room_code")
    .eq("id", challengeId)
    .single();
  if (error || !ch) throw new Error("not_found");
  // Only the challenged player can report an acceptance, and only once.
  if (ch.challenged_id !== accepterId) throw new Error("forbidden");
  if (throttled(`challenge_accepted:${challengeId}`, 5 * 60 * 1000)) {
    return NextResponse.json({ ok: true, skipped: "throttled" });
  }
  if (ch.status !== "accepted") throw new Error("not_accepted");
  const { data: me } = await sb
    .from("profiles")
    .select("full_name, username")
    .eq("id", accepterId)
    .single();
  const name = displayName(me);
  const body = `${name} đã chấp nhận lời thách đấu của bạn — vào phòng thi đấu ngay!`;
  // Deep link into the room: no_join_room is idempotent for members, and
  // the challenger created the room, so the invite flow opens it directly.
  const url = ch.room_code ? `/?room=${ch.room_code}` : "/";
  const { sent } = await sendPushToUser(ch.challenger_id, {
    title: "⚔️ Thách đấu được chấp nhận!",
    body,
    url,
    tag: `challenge-accepted-${ch.id}`,
  });
  await recordNotification(sb, {
    user_id: ch.challenger_id,
    kind: "challenge_accepted",
    title: "⚔️ Thách đấu được chấp nhận!",
    body,
    url,
    ref_id: ch.id,
  });
  return NextResponse.json({ ok: true, sent });
}
