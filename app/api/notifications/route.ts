import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { needAuth } from "../push/_auth";

const PAGE_SIZE = 20;

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("not_configured");
  return createClient(url, serviceKey);
}

/** GET: list my notifications (newest first) + unread count. ?before=<iso> for pagination. */
export async function GET(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const sb = service();
  const before = new URL(req.url).searchParams.get("before");
  let q = sb
    .from("no_notifications")
    .select("id,kind,title,body,url,ref_id,read_at,created_at")
    .eq("user_id", auth.uid)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (before) q = q.lt("created_at", before);
  const [{ data, error }, { data: unreadRows }] = await Promise.all([
    q,
    sb
      .from("no_notifications")
      .select("id")
      .eq("user_id", auth.uid)
      .is("read_at", null),
  ]);
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({
    notifications: data ?? [],
    unread: unreadRows?.length ?? 0,
  });
}

/**
 * POST { id } — mark one notification read.
 * POST { all: true } — mark all read.
 */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const sb = service();
  let body: { id?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const now = new Date().toISOString();
  if (body.all) {
    const { error } = await sb
      .from("no_notifications")
      .update({ read_at: now })
      .eq("user_id", auth.uid)
      .is("read_at", null);
    if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.id) {
    const { error } = await sb
      .from("no_notifications")
      .update({ read_at: now })
      .eq("id", body.id)
      .eq("user_id", auth.uid);
    if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}
