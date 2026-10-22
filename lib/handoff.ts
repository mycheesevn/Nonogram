/**
 * One-tap login hand-off (full-mesh SSO): ask the family mint endpoint
 * (hosted on PacClone, which holds the service-role key for push) for a
 * one-time magic-link URL for the signed-in user's own account,
 * targeting any family site — another game or the hub. Any failure
 * returns the plain target URL — the player just signs in manually at
 * the destination, exactly as before.
 */
const HANDOFF_ENDPOINT = "https://cotuong.synerworlds.com/api/handoff";

export async function handoffUrl(
  targetUrl: string,
  accessToken: string,
): Promise<string> {
  try {
    const res = await fetch(HANDOFF_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ target_url: targetUrl }),
    });
    if (!res.ok) return targetUrl;
    const out = (await res.json().catch(() => null)) as {
      url?: string;
    } | null;
    return out?.url ?? targetUrl;
  } catch {
    return targetUrl;
  }
}
