"use client";

import { useEffect, useMemo, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  claimSudCheckin,
  fetchSudCheckinHistory,
} from "@/lib/supabase/checkin";

interface Props {
  lang: Lang;
  user: { id: string } | null;
  onLogin: () => void;
}

/** "Today" in the game's primary timezone (Asia/Ho_Chi_Minh), matching
 *  the server's check-in day boundary — see skill retention.md. */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function CheckinView({ lang, user, onLogin }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [streak, setStreak] = useState<number | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [history, setHistory] = useState<{ checkin_date: string; streak: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!user) return;
    fetchSudCheckinHistory()
      .then((h) => {
        setHistory(h);
        const todayRow = h.find((r) => r.checkin_date === todayKey());
        if (todayRow) {
          setStreak(todayRow.streak);
          setClaimed(true);
        }
      })
      .catch(() => {});
  }, [user]);

  const claim = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await claimSudCheckin();
      if (!r) {
        setMsg(lang === "vi" ? "Lỗi, thử lại sau." : "Error, try again.");
        return;
      }
      setStreak(r.streak);
      setClaimed(true);
      setMsg(
        lang === "vi"
          ? `+${r.xp_awarded} XP! ${String(s.checkinStreak)} ${r.streak} ${String(s.checkinStreakDays)} 🔥`
          : `+${r.xp_awarded} XP! ${String(s.checkinStreak)}: ${r.streak} ${String(s.checkinStreakDays)} 🔥`
      );
      const h = await fetchSudCheckinHistory();
      setHistory(h);
    } catch {
      setMsg(lang === "vi" ? "Lỗi, thử lại sau." : "Error, try again.");
    } finally {
      setBusy(false);
    }
  };

  // Fixed 7-day strip ending today; claimed dates get ✅.
  const week = useMemo(() => {
    const claimedSet = new Set(history.map((h) => h.checkin_date));
    const out: { key: string; label: string; done: boolean }[] = [];
    // Anchor the strip on the game-timezone "today" so the last cell is
    // always the server's current check-in day.
    const today = new Date(todayKey() + "T00:00:00");
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ key, label: dayLabel(key), done: claimedSet.has(key) });
    }
    return out;
  }, [history]);

  if (!user) {
    return (
      <div className="sud-scroll-area">
        <div className="sud-view">
          <h2>📅 {String(s.checkinTitle)}</h2>
          <div className="sud-panel">
            <p className="sud-hint">{String(s.checkinLoginTeaser)}</p>
            <button
              type="button"
              className="sud-btn sud-btn-primary"
              onClick={onLogin}
            >
              {String(s.login)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>📅 {String(s.checkinTitle)}</h2>
        {streak !== null && (
          <p className="sud-streak">
            🔥 {String(s.checkinStreak)}: {streak} {String(s.checkinStreakDays)}
          </p>
        )}
        <button
          type="button"
          className="sud-btn sud-btn-primary"
          disabled={claimed || busy}
          onClick={claim}
        >
          {claimed
            ? String(s.checkinClaimed)
            : busy
              ? "…"
              : String(s.checkinClaim)}
        </button>
        {msg && <p className="sud-msg">{msg}</p>}
        <div className="sud-cal">
          {week.map((d) => (
            <div key={d.key} className="sud-cal-day">
              <span>{d.done ? "✅" : "·"}</span>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
        <p className="sud-hint">
          {lang === "vi"
            ? "10 XP cơ bản, +5 mỗi ngày liên tiếp, tối đa 40 XP/ngày."
            : "10 base XP, +5 per consecutive day, capped at 40 XP/day."}
        </p>
      </div>
    </div>
  );
}
