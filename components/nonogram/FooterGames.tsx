"use client";

/**
 * Dynamic Top-N games line for the shared family footer.
 *
 * Fetches the weekly "most played" ranking once from the shared
 * Supabase project (RPC footer_top(), hub migration 010), cached in
 * module memory + localStorage for 6h, and renders the top N in rank
 * order followed by the All-games link. ANY failure (offline, RPC
 * missing, empty) silently keeps the hardcoded fallback passed in by
 * SiteFooter — the footer renders exactly as it always has.
 */

import { useEffect, useState } from "react";
import HandoffLink from "./HandoffLink";

export type FooterGame = { vi: string; en: string; url: string };

const CACHE_KEY = "sw-footer-top-v1";
const TTL_MS = 6 * 60 * 60 * 1000;
const ALL_URL = "https://synerworlds.com";

type TopData = { n: number; games: FooterGame[] };
let memo: { at: number; data: TopData } | null = null;

async function loadTop(): Promise<TopData | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.data;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { at: number; data: TopData };
      if (Date.now() - c.at < TTL_MS && c.data?.games?.length) {
        memo = c;
        return c.data;
      }
    }
  } catch {
    /* cache unavailable */
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/footer_top`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) return null;
    const t = (await res.json()) as {
      n?: number;
      games?: Array<{ slug: string; vi: string; en: string; url: string }>;
    };
    if (!t || !Array.isArray(t.games) || t.games.length === 0) return null;
    const data: TopData = {
      n: typeof t.n === "number" && t.n > 0 ? t.n : 10,
      games: t.games.map((g) => ({ vi: g.vi, en: g.en, url: g.url })),
    };
    memo = { at: Date.now(), data };
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(memo));
    } catch {
      /* ignore */
    }
    return data;
  } catch {
    return null;
  }
}

export default function FooterGames({
  lang,
  fallback,
  linkStyle,
}: {
  lang: "vi" | "en";
  fallback: FooterGame[];
  linkStyle?: React.CSSProperties;
}) {
  const en = lang === "en";
  const [games, setGames] = useState<FooterGame[]>(fallback);
  useEffect(() => {
    let live = true;
    loadTop().then((d) => {
      if (live && d) setGames(d.games.slice(0, d.n));
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      {games.map((g, i) => (
        <span key={g.url}>
          {i > 0 ? ", " : ""}
          <HandoffLink href={g.url} newTab style={linkStyle}>
            {en ? g.en : g.vi}
          </HandoffLink>
        </span>
      ))}
      {", "}
      <HandoffLink href={ALL_URL} newTab style={linkStyle}>
        {en ? "All games" : "Tất cả trò chơi"}
      </HandoffLink>
    </>
  );
}
