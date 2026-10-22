import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { needAuth } from "../_auth";

/** Remove this device's push subscription. */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const { uid } = auth;

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = (req.headers.get("authorization") || "").slice(7);
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const q = sb.from("no_push_subscriptions").delete().eq("user_id", uid);
  const { error } = body.endpoint ? await q.eq("endpoint", body.endpoint) : await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
