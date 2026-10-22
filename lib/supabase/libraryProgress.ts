import { getSupabase } from "./client";

const LOCAL_KEY = "no-library-done";

/** Local completed lesson ids (guests + offline cache). */
export function loadLocalDone(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveLocalDone(ids: string[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** Cloud completed lesson ids for the logged-in user (null when logged out / unconfigured). */
export async function fetchCloudDone(): Promise<string[] | null> {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb
      .from("library_progress")
      .select("lesson_id")
      .eq("user_id", user.id);
    if (error || !data) return null;
    return data.map((r: { lesson_id: string }) => r.lesson_id);
  } catch {
    return null;
  }
}

/** Record a completed lesson locally and in the cloud (when logged in). */
export async function completeLesson(lessonId: string): Promise<string[]> {
  const merged = Array.from(new Set([...loadLocalDone(), lessonId]));
  saveLocalDone(merged);
  try {
    const sb = getSupabase();
    if (!sb) return merged;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      await sb.from("library_progress").upsert(
        {
          user_id: user.id,
          lesson_id: lessonId,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,lesson_id" }
      );
    }
  } catch {
    /* offline or not configured — local progress is already saved */
  }
  return merged;
}

/** Merge cloud progress into the local cache (call after login). */
export async function syncLibraryProgress(): Promise<string[]> {
  const local = loadLocalDone();
  const cloud = await fetchCloudDone();
  if (!cloud) return local;
  const merged = Array.from(new Set([...local, ...cloud]));
  saveLocalDone(merged);
  // Push any local-only completions to the cloud.
  try {
    const sb = getSupabase();
    if (!sb) return merged;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      const missing = local.filter((id) => !cloud.includes(id));
      if (missing.length > 0) {
        await sb.from("library_progress").upsert(
          missing.map((lesson_id) => ({
            user_id: user.id,
            lesson_id,
            completed_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,lesson_id" }
        );
      }
    }
  } catch {
    /* ignore */
  }
  return merged;
}
