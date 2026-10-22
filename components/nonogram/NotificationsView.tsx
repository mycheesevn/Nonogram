"use client";

import { useCallback, useEffect, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/supabase/notifications";
import { Pagination, usePagination } from "./Pagination";

const PAGE_SIZE = 10;

interface Props {
  lang: Lang;
  /** Called after the list changes (e.g. marked read) so the header badge refreshes. */
  onChanged?: () => void;
}

function fmtDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleString(lang === "vi" ? "vi-VN" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function NotificationsView({ lang, onChanged }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const paging = usePagination(items, PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    const { notifications } = await fetchNotifications();
    setItems(notifications);
    setHasMore(notifications.length >= 20);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    const { notifications } = await fetchNotifications(
      items[items.length - 1].created_at
    );
    if (notifications.length > 0) {
      setItems((prev) => [...prev, ...notifications]);
      setHasMore(notifications.length >= 20);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const openNotification = (n: AppNotification) => {
    if (!n.read_at) {
      markNotificationRead(n.id);
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
        )
      );
      onChanged?.();
    }
    window.location.href = n.url || "/";
  };

  const markAll = async () => {
    await markAllNotificationsRead();
    setItems((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() }))
    );
    onChanged?.();
  };

  const unreadCount = items.filter((x) => !x.read_at).length;

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2>🔔 {String(s.notifTitle)}</h2>
          {unreadCount > 0 && (
            <button
              type="button"
              className="sud-btn small"
              onClick={markAll}
            >
              ✓ {String(s.notifMarkAllRead)}
            </button>
          )}
        </div>
        {loading ? (
          <p className="sud-empty-note">{String(s.loading)}</p>
        ) : items.length === 0 ? (
          <p className="sud-empty-note">{String(s.notifEmpty)}</p>
        ) : (
          <>
            <ul className="sud-board-list">
              {paging.pageItems.map((n) => (
                <li key={n.id} className="sud-lb-row">
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      flex: 1,
                      fontWeight: n.read_at ? 400 : 700,
                      color: "inherit",
                      font: "inherit",
                    }}
                  >
                    <span className="sud-lb-name">
                      {!n.read_at && (
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#4dabf7",
                            marginRight: 6,
                          }}
                        />
                      )}
                      {n.title}
                    </span>
                    <br />
                    <span className="sud-hint">
                      {n.body} · {fmtDate(n.created_at, lang)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              page={paging.page}
              pageCount={paging.pageCount}
              onPage={paging.setPage}
            />
            {hasMore && (
              <button
                type="button"
                className="sud-btn small"
                disabled={loadingMore}
                onClick={loadMore}
                style={{ marginTop: 8 }}
              >
                {loadingMore ? String(s.loading) : String(s.notifLoadMore)}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
