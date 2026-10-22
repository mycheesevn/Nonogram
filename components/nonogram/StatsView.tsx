"use client";

import { useEffect, useMemo, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import {
  fetchGameStats,
  type GameStats,
  type StatBucket,
} from "@/lib/supabase/stats";

type Range = "day" | "week" | "month" | "year";
type Subject = "plays" | "members";

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function fmtMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${m}/${y}`;
}

/** Site-wide 📊 statistics tab (PacClone standard — skill stats.md):
 *  3 summary cards + plays/members bar chart by day/week/month/year. */
export function StatsView({ lang }: { lang: Lang }) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("day");
  const [subject, setSubject] = useState<Subject>("plays");

  useEffect(() => {
    fetchGameStats().then((st) => {
      setStats(st);
      setLoading(false);
    });
  }, []);

  const buckets: StatBucket[] = useMemo(() => {
    if (!stats) return [];
    const key = `${subject === "plays" ? "plays" : "members"}_${
      range === "day"
        ? "daily"
        : range === "week"
          ? "weekly"
          : range === "month"
            ? "monthly"
            : "yearly"
    }`;
    return (stats as unknown as Record<string, StatBucket[]>)[key] ?? [];
  }, [stats, range, subject]);

  const bars = useMemo(() => {
    if (range === "day") {
      // Last 14 days, zero-filled.
      const map = new Map(buckets.map((b) => [b.d.slice(0, 10), b.c]));
      const out: { label: string; value: number }[] = [];
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        out.push({
          label: fmtDay(localKey(d)),
          value: map.get(localKey(d)) ?? 0,
        });
      }
      return out;
    }
    return buckets.map((b) => ({
      label:
        range === "week"
          ? fmtDay(b.d.slice(0, 10))
          : range === "month"
            ? fmtMonth(b.d.slice(0, 10))
            : b.d.slice(0, 4),
      value: b.c,
    }));
  }, [buckets, range]);

  const max = Math.max(1, ...bars.map((b) => b.value));

  if (loading) {
    return <p className="sud-empty-note">{String(s.statsLoading)}</p>;
  }
  if (!stats) {
    return <p className="sud-empty-note">{String(s.statsUnavailable)}</p>;
  }

  const ranges: Range[] = ["day", "week", "month", "year"];
  const rangeLabel: Record<Range, string> = {
    day: String(s.statsByDay),
    week: String(s.statsByWeek),
    month: String(s.statsByMonth),
    year: String(s.statsByYear),
  };

  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
      <div className="sud-stat-cards">
        <div className="sud-stat-card">
          <div className="num">🎮 {stats.plays_total}</div>
          <div className="lbl">{String(s.statsTotalPlays)}</div>
          <div className="sub">
            {stats.plays_member} {String(s.statsMembers).toLowerCase()} ·{" "}
            {stats.plays_guest} {String(s.statsGuests).toLowerCase()}
          </div>
        </div>
        <div className="sud-stat-card">
          <div className="num">✅ {stats.finished}</div>
          <div className="lbl">{String(s.statsFinished)}</div>
          <div className="sub">
            🏳️ {stats.abandoned} {String(s.statsAbandoned).toLowerCase()}
          </div>
        </div>
        <div className="sud-stat-card">
          <div className="num">👥 {stats.members_total}</div>
          <div className="lbl">{String(s.statsMembers)}</div>
          <div className="sub">
            +{stats.members_today} {String(s.statsToday).toLowerCase()} · +
            {stats.members_week} {String(s.statsThisWeek).toLowerCase()} · +
            {stats.members_month} {String(s.statsThisMonth).toLowerCase()}
          </div>
        </div>
      </div>

      <div className="sud-lb-tabs sud-stat-subject">
        <button
          type="button"
          className={subject === "plays" ? "active" : ""}
          onClick={() => setSubject("plays")}
        >
          🎮 {String(s.statsPlays)}
        </button>
        <button
          type="button"
          className={subject === "members" ? "active" : ""}
          onClick={() => setSubject("members")}
          title={String(s.statsNewMembers)}
        >
          🆕 {String(s.statsNewMembersTab)}
        </button>
      </div>

      <div className="sud-lb-tabs">
        {ranges.map((r) => (
          <button
            key={r}
            type="button"
            className={range === r ? "active" : ""}
            onClick={() => setRange(r)}
          >
            {rangeLabel[r]}
          </button>
        ))}
      </div>

      <div className="sud-chart" role="img" aria-label={String(s.statsTab)}>
        {bars.map((b, i) => (
          <div key={i} className="sud-bar-col" title={`${b.label}: ${b.value}`}>
            <span className="sud-bar-val">{b.value > 0 ? b.value : ""}</span>
            <div
              className="sud-bar"
              style={{ height: `${Math.max(2, (b.value / max) * 100)}%` }}
            />
            <span className="sud-bar-label">{b.label}</span>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
