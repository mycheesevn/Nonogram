import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Shared session cookie: on the family domains the Supabase session
 * cookie is scoped to .synerworlds.com, so signing in on ANY family
 * site (hub or any game) signs the player in on ALL of them — no
 * hand-off needed for ordinary navigation. Elsewhere (localhost dev,
 * legacy *.vercel.app) the cookie stays host-only, exactly as before.
 */
function familyCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.hostname.endsWith("synerworlds.com")
    ? ".synerworlds.com"
    : undefined;
}

/** Client-side only. Throws a clear error if env vars are missing. */
export function createClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  cached = createBrowserClient(url, key, {
    cookieOptions: { domain: familyCookieDomain() },
  });
  return cached;
}

/** Nullable variant: null when env is missing (solo play unaffected). */
export function getSupabase() {
  try {
    return createClient();
  } catch {
    return null;
  }
}
