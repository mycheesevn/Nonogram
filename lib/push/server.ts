import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails("mailto:mycheesevn@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
  vapidConfigured = true;
  return true;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error("push_not_configured");
  return createClient(url, service);
}

/** All stored subscriptions for a user. */
export async function getUserSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("no_push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || []) as PushSubscriptionRow[];
}

/** Remove subscriptions whose endpoints are dead (410/404). */
async function pruneDead(endpoints: string[]) {
  if (!endpoints.length) return;
  try {
    const sb = serviceClient();
    await sb.from("no_push_subscriptions").delete().in("endpoint", endpoints);
  } catch {
    /* best effort */
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a push to every device subscribed by the user. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!ensureVapid()) throw new Error("push_not_configured");
  const subs = await getUserSubscriptions(userId);
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 86400 }
        );
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) dead.push(s.endpoint);
      }
    })
  );
  await pruneDead(dead);
  return { sent, failed: subs.length - sent };
}
