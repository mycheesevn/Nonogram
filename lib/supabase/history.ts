"use client";

import { createClient } from "./client";

export interface NoGameRow {
  id: string;
  mode: "solo" | "daily" | "race";
  picture_id: string;
  size: number;
  tier: number;
  result: "win" | "loss" | "draw";
  reason: string | null;
  mistakes: number;
  hints_used: number;
  seconds: number;
  perfect: boolean;
  moves: string;
  created_at: string;
}

/** The player's games (solo + daily + race), newest first, paged server-side. */
export async function fetchGames(
  userId: string,
  page: number,
  pageSize: number
): Promise<{ rows: NoGameRow[]; total: number }> {
  const from = page * pageSize;
  try {
    const sb = createClient();
    const { data, error, count } = await sb
      .from("no_games")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error || !data) return { rows: [], total: 0 };
    const rows: NoGameRow[] = (data as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      mode: (r.mode as NoGameRow["mode"]) ?? "solo",
      picture_id: String(r.picture_id ?? ""),
      size: Number(r.size) || 10,
      tier: Number(r.tier) || 2,
      result: r.result as NoGameRow["result"],
      reason: (r.reason as string | null) ?? null,
      mistakes: Number(r.mistakes) || 0,
      hints_used: Number(r.hints_used) || 0,
      seconds: Number(r.seconds) || 0,
      perfect: Boolean(r.perfect),
      moves: String(r.moves ?? ""),
      created_at: String(r.created_at),
    }));
    return { rows, total: count ?? 0 };
  } catch {
    return { rows: [], total: 0 };
  }
}
