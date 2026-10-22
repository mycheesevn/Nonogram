import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { needAuth } from "../_auth";

/** Store (or refresh) this device's push subscription for the caller. */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const { uid } = auth;

  let body: { endpoint?: string; p256dh?: string; auth?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = (req.headers.get("authorization") || "").slice(7);
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error } = await sb.from("no_push_subscriptions").upsert(
    { user_id: uid, endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth },
    { onConflict: "user_id,endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
