"use client";

import { useEffect, useRef, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  ROOM_CHAT_PAGE,
  fetchRoomMessages,
  postRoomMessage,
  subscribeRoomMessages,
  type RoomChatMessage,
} from "@/lib/supabase/roomChat";
import { fetchNames } from "@/lib/supabase/rooms";

/**
 * In-room private text chat (family pattern, references/room-chat.md).
 * Members-only stream for the room (not a race), cloned from the
 * RoomMatchView comments markup: same feed rows, names via
 * fetchNames, sticky auto-scroll that only follows when the reader is
 * near the bottom. Guests see nothing (select is member-only) and
 * cannot post. Send failures surface as visible error text — never
 * swallowed.
 */
export function RoomChat({
  roomId,
  lang,
  disabled,
}: {
  roomId: string;
  lang: Lang;
  disabled?: boolean;
}) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLUListElement | null>(null);
  const stickRef = useRef(true);

  // Sticky auto-scroll: follow new messages while the reader stays near
  // the bottom (same intent as the comments path).
  useEffect(() => {
    const el = feedRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    let live = true;
    fetchRoomMessages(roomId)
      .then((rows) => {
        if (!live) return;
        setMessages(rows);
        setHasMore(rows.length >= ROOM_CHAT_PAGE);
      })
      .catch(() => {
        if (live) setError(String(s.roomChatLoadError));
      });
    const ch = subscribeRoomMessages(roomId, async (m) => {
      // Realtime rows arrive without the author name; resolve it the
      // same way the comments path does (fetchNames).
      let row = m;
      if (!m.user_name) {
        const names = await fetchNames([m.user_id]).catch(
          (): Record<string, string> => ({})
        );
        if (!live) return;
        row = { ...m, user_name: names[m.user_id] ?? "…" };
      }
      // Dedupe the local-post/realtime echo by id (comments path parity).
      setMessages((prev) =>
        prev.some((x) => x.id === row.id) ? prev : [...prev, row]
      );
    });
    return () => {
      live = false;
      ch.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const loadMore = async () => {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const older = await fetchRoomMessages(roomId, messages[0].created_at);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= ROOM_CHAT_PAGE);
    } catch {
      /* keep the visible feed; a retry is always possible */
    } finally {
      setLoadingMore(false);
    }
  };

  const doPost = async () => {
    const body = draft.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    setError(null);
    try {
      await postRoomMessage(roomId, body);
      setDraft("");
      const fresh = await fetchRoomMessages(roomId);
      setMessages(fresh);
      setHasMore(fresh.length >= ROOM_CHAT_PAGE);
    } catch {
      setError(String(s.roomChatSendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sud-roomchat-block">
      <h3>✉️ {String(s.roomChat)} ({messages.length})</h3>
      {hasMore && (
        <button
          type="button"
          className="sud-btn small"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {String(s.roomLoadMore)}
        </button>
      )}
      {messages.length === 0 ? (
        <p className="sud-hint">{String(s.roomNoMessages)}</p>
      ) : (
        <ul className="sud-comment-list" ref={feedRef} onScroll={onScroll}>
          {messages.map((m) => (
            <li key={m.id} className="sud-comment">
              <div className="sud-comment-head">
                <strong>{m.user_name ?? "…"}</strong>
                <span className="sud-hint">
                  {new Date(m.created_at).toLocaleString(
                    lang === "vi" ? "vi-VN" : "en-US",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                    }
                  )}
                </span>
              </div>
              <div>{m.body}</div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="sud-setup-error" role="alert">
          {error}
        </p>
      )}

      <div className="sud-comment-form">
        <input
          className="sud-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={String(s.roomChatPlaceholder)}
          maxLength={500}
          disabled={disabled || sending}
          onKeyDown={(e) => {
            if (e.key === "Enter") void doPost();
          }}
        />
        <button
          type="button"
          className="sud-btn small"
          onClick={() => void doPost()}
          disabled={!draft.trim() || sending || disabled}
        >
          {String(s.roomSend)}
        </button>
      </div>
    </div>
  );
}
