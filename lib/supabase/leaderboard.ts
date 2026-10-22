"use client";

import { createClient } from "./client";

export interface SudLeaderRow {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  xp: number;
  wins: number;
  games_played: number;
  /** Elo rating + peak (migration 006); default 800 before it lands. */
  rating: number;
  peak_rating: number;
}

/** Top players by XP via the no_leaderboard(p_limit) RPC.
 *  rank is already global (1-based) — render it directly. Avatars are
 *  batch-fetched from profiles afterwards (the RPC predates avatar
 *  display; profiles are client-readable, like fetchNames). */
export async function fetchSudLeaderboard(
  limit: number = 100
): Promise<SudLeaderRow[]> {
  try {
    const sb = createClient();
    const { data, error } = await sb.rpc("no_leaderboard", {
      p_limit: limit,
    });
    if (error || !data || !Array.isArray(data)) return [];
    const rows: SudLeaderRow[] = data.map((r) => ({
      rank: Number(r.rank) || 0,
      user_id: String(r.user_id),
      display_name: String(r.display_name ?? "Player"),
      avatar_url: null,
      xp: Number(r.xp) || 0,
      wins: Number(r.wins) || 0,
      games_played: Number(r.games_played) || 0,
      rating: Number(r.rating) || 800,
      peak_rating: Number(r.peak_rating) || 800,
    }));
    if (rows.length > 0) {
      const { data: profs } = await sb
        .from("profiles")
        .select("id, avatar_url")
        .in(
          "id",
          rows.map((r) => r.user_id)
        );
      const byId = new Map(
        ((profs ?? []) as Array<{ id: string; avatar_url: string | null }>).map(
          (p) => [p.id, p.avatar_url]
        )
      );
      for (const r of rows) r.avatar_url = byId.get(r.user_id) ?? null;
    }
    return rows;
  } catch {
    return [];
  }
}
