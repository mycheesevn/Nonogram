"use client";

import { createClient } from "./client";

/**
 * Record a finished solo/daily game for the logged-in player.
 * Writes the no_games history row and updates no_stats (XP computed
 * server-side from the locked size×tier table, +10 daily bonus once
 * per day per size) inside the no_record_game_result() RPC.
 * Returns the XP awarded.
 */
export async function recordGameResult(args: {
  result: "win" | "loss" | "draw";
  mode: "solo" | "daily";
  pictureId: string;
  size: number;
  tier: number;
  seconds: number;
  mistakes: number;
  hintsUsed: number;
  perfect: boolean;
  moves: string;
}): Promise<number> {
  const sb = createClient();
  const { data, error } = await sb.rpc("no_record_game_result", {
    p_result: args.result,
    p_mode: args.mode,
    p_picture_id: args.pictureId,
    p_size: args.size,
    p_tier: args.tier,
    p_seconds: args.seconds,
    p_mistakes: args.mistakes,
    p_hints_used: args.hintsUsed,
    p_perfect: args.perfect,
    p_moves: args.moves,
  });
  if (error) throw error;
  return data as number;
}
