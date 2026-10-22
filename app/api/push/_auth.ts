import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Resolve the calling user from `Authorization: Bearer <supabase access token>`.
 * Returns null when missing/invalid.
 */
export async function authedUserId(req: Request): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!url || !anon || !token) return null;
  const sb = createClient(url, anon);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export function needAuth(req: Request) {
  return authedUserId(req).then((uid) =>
    uid ? { uid } : { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  );
}
