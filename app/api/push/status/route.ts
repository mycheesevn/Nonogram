import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createECDH } from "crypto";
import { needAuth } from "../_auth";

/**
 * Push diagnostics (no secrets exposed).
 * Returns: whether VAPID is configured, whether the public/private keys
 * actually form a pair, and how many subscriptions this user has.
 */
function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("not_configured");
  return createClient(url, serviceKey);
}

/** Derive the public key from the private key and compare with configured public. */
function keysMatch(pubB64: string, privB64: string): boolean {
  try {
    const ecdh = createECDH("prime256v1");
    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const priv = Buffer.from(
      pad(privB64).replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    ecdh.setPrivateKey(priv);
    const derived = ecdh.getPublicKey(null, "uncompressed").toString("base64url");
    const norm = (s: string) => s.replace(/=+$/, "");
    return norm(derived) === norm(pubB64);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const auth = await needAuth(req);
  if ("error" in auth) return auth.error;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  const vapidConfigured = !!(pub && priv);
  let subscriptionCount = -1;
  try {
    const sb = service();
    const { data, count } = await sb
      .from("no_push_subscriptions")
      .select("id", { count: "exact" })
      .eq("user_id", auth.uid);
    subscriptionCount = count ?? data?.length ?? 0;
  } catch {
    /* leave as -1 */
  }
  return NextResponse.json({
    vapidConfigured,
    keysMatch: vapidConfigured ? keysMatch(pub, priv) : false,
    subscriptionCount,
  });
}
