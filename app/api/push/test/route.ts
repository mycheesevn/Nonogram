import { NextResponse } from "next/server";
import { needAuth } from "../_auth";
import { sendPushToUser } from "@/lib/push/server";

/** Send a test push to the caller's own devices. */
export async function POST(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  try {
    const { sent } = await sendPushToUser(auth.uid, {
      title: "🔢 Nonogram",
      body: "Thông báo đẩy đang hoạt động! / Push notifications are working!",
      url: "/",
      tag: "push-test",
    });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
