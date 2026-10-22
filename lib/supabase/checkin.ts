"use client";

import { createClient } from "./client";

export interface SudCheckinResult {
  streak: number;
  xp_awarded: number;
  already_claimed: boolean;
}

/** Claim today's check-in via the no_claim_checkin() RPC (authenticated,
 *  idempotent — returns already_claimed=true when claimed already). */
export async function claimSudCheckin(): Promise<SudCheckinResult | null> {
  try {
    const sb = createClient();
    const { data, error } = await sb.rpc("no_claim_checkin");
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      streak: Number(row.streak) || 0,
      xp_awarded: Number(row.xp_awarded) || 0,
      already_claimed: Boolean(row.already_claimed),
    };
  } catch {
    return null;
  }
}

export interface SudCheckinDay {
  checkin_date: string; // YYYY-MM-DD in the game's primary timezone
  streak: number;
}

/** Last 7 check-in rows for the calendar UI, via no_checkin_history(). */
export async function fetchSudCheckinHistory(): Promise<SudCheckinDay[]> {
  try {
    const sb = createClient();
    const { data, error } = await sb.rpc("no_checkin_history");
    if (error || !data || !Array.isArray(data)) return [];
    return data.map((r) => ({
      checkin_date: String(r.checkin_date).slice(0, 10),
      streak: Number(r.streak) || 0,
    }));
  } catch {
    return [];
  }
}
