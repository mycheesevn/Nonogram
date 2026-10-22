/**
 * Push-notification event wiring.
 * Callers fire challenge events (received / accepted / declined); the
 * server verifies the real DB state before sending anything.
 * Races have no turns and there is no correspondence mode, so those
 * kinds do not exist here. Best-effort: failures never break the
 * game flow.
 */
import { notifyPushTrigger } from "@/lib/push/client";

export async function fireEvent(
  kind: "challenge" | "challenge_declined" | "challenge_accepted",
  payload: Record<string, string>
): Promise<void> {
  try {
    if (kind === "challenge" && payload.challenge) {
      await notifyPushTrigger({ kind: "challenge", challengeId: payload.challenge });
    } else if (kind === "challenge_declined" && payload.challenge) {
      await notifyPushTrigger({
        kind: "challenge_declined",
        challengeId: payload.challenge,
      });
    } else if (kind === "challenge_accepted" && payload.challenge) {
      await notifyPushTrigger({
        kind: "challenge_accepted",
        challengeId: payload.challenge,
      });
    }
  } catch {
    /* push is best-effort; never break the game flow */
  }
}
