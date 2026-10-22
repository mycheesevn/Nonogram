/** Beginner quests (no_quests + no_claim_quest, migration 001).
 *  Three one-time quests, +20 XP each; completion is verified
 *  server-side from real activity (a recorded game, a win, a room
 *  membership) — the client only asks. */
import { createClient } from "./client";

export const QUESTS = [
  { id: "play_1", xp: 20 },
  { id: "win_1", xp: 20 },
  { id: "join_room", xp: 20 },
] as const;

export async function claimedQuests(): Promise<Set<string>> {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new Set();
  const { data } = await sb
    .from("no_quests")
    .select("quest_id")
    .eq("user_id", user.id);
  return new Set(
    ((data ?? []) as Array<{ quest_id: string }>).map((r) => r.quest_id),
  );
}

/** Returns true when the quest was complete and the XP was granted
 *  by this call (false = not done yet, or already claimed). */
export async function claimQuest(questId: string): Promise<boolean> {
  const sb = createClient();
  const { data, error } = await sb.rpc("no_claim_quest", {
    p_quest_id: questId,
  });
  if (error) throw error;
  return data === true;
}
