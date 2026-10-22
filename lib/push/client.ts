/**
 * Client-side Web Push helpers: permission, subscribe/unsubscribe, capability
 * detection (incl. the iOS 16.4+ "must be installed to Home Screen" rule).
 */

export function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
}

export type PushCapability =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-needs-install" | "no-sw" | "not-configured" };

export function pushCapability(): PushCapability {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (!vapidPublicKey()) return { ok: false, reason: "not-configured" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  // iOS 16.4+: push only works from the installed PWA (standalone), not Safari.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !standalone) return { ok: false, reason: "ios-needs-install" };
  return { ok: true };
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function swRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("no-sw");
  // navigator.serviceWorker.ready can hang indefinitely if the SW
  // registration is broken; timeout after 5s.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("sw-timeout")), 5000)
    ),
  ]);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushSubJSON {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Current push subscription on this device, if any. */
export async function currentSubscription(): Promise<PushSubJSON | null> {
  try {
    const reg = await swRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  } catch {
    return null;
  }
}

/**
 * Subscribe this device for push. Resolves true when the server stored it.
 * Throws "denied" when the user blocks the permission prompt,
 * "not-configured" when no VAPID public key is set.
 */
export async function subscribePush(accessToken: string): Promise<boolean> {
  const cap = pushCapability();
  if (!cap.ok) throw new Error(cap.reason);
  const perm =
    "Notification" in window ? await Notification.requestPermission() : "denied";
  if (perm !== "granted") throw new Error("denied");

  const reg = await swRegistration();
  // Always drop any existing subscription first: after a VAPID key rotation
  // the old subscription is cryptographically tied to the old key and the
  // push service will reject sends. pushManager.subscribe() may otherwise
  // return the stale subscription.
  try {
    const old = await reg.pushManager.getSubscription();
    await old?.unsubscribe();
  } catch {
    /* ignore */
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      vapidPublicKey()
    ) as BufferSource,
  });
  const j = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      endpoint: j.endpoint,
      p256dh: j.keys?.p256dh,
      auth: j.keys?.auth,
    }),
  });
  if (!res.ok) {
    // Roll back the browser-side subscription so state stays consistent.
    await sub.unsubscribe().catch(() => {});
    throw new Error("server_error");
  }
  return true;
}

/** Remove this device's push subscription (browser + server). */
export async function unsubscribePush(accessToken: string): Promise<void> {
  const existing = await currentSubscription();
  try {
    const reg = await swRegistration();
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* ignore */
  }
  if (existing) {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    }).catch(() => {});
  }
}

/** Send a test notification to this user's devices. */
export async function sendTestPush(accessToken: string): Promise<boolean> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.ok;
}

export interface PushStatus {
  vapidConfigured: boolean;
  keysMatch: boolean;
  subscriptionCount: number;
}

/** Server-side push diagnostics (no secrets exposed). */
export async function fetchPushStatus(
  accessToken: string
): Promise<PushStatus | null> {
  try {
    const res = await fetch("/api/push/status", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as PushStatus;
  } catch {
    return null;
  }
}

/** Tell the server an event happened; it verifies and pushes to the other party. */
export async function notifyPushTrigger(
  payload:
    | { kind: "challenge"; challengeId: string }
    | { kind: "challenge_declined"; challengeId: string }
    | { kind: "challenge_accepted"; challengeId: string }
    | { kind: "turn"; matchId: string }
    | { kind: "corr"; gameId: string }
    | { kind: "corr_end"; gameId: string }
): Promise<void> {
  try {
    const sb = (await import("@/lib/supabase/client")).getSupabase();
    const { data } = (await sb?.auth.getSession()) || { data: null };
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch("/api/push/trigger", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* push is best-effort; never break the game flow */
  }
}
