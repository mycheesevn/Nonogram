import { getSupabase } from "./client";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const {
    data: { session },
  } = await sb.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchNotifications(
  before?: string
): Promise<{ notifications: AppNotification[]; unread: number }> {
  const url = before
    ? `/api/notifications?before=${encodeURIComponent(before)}`
    : "/api/notifications";
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) return { notifications: [], unread: 0 };
  const j = await res.json();
  return {
    notifications: (j.notifications ?? []) as AppNotification[],
    unread: j.unread ?? 0,
  };
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

export async function markAllNotificationsRead(): Promise<void> {
  await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ all: true }),
  }).catch(() => {});
}
