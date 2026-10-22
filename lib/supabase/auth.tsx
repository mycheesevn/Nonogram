"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "./client";

export interface SudUser {
  id: string;
  email?: string;
}

/** Same columns chess selects from the SHARED `profiles` table — never recreate it. */
export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  birth_date: string | null;
  city: string | null;
  country: string | null;
}

export interface SudStats {
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  /** Elo rating (migration 006); 800 until the migration lands. */
  rating: number;
  peak_rating: number;
}

interface AuthCtx {
  user: SudUser | null;
  profile: Profile | null;
  cgStats: SudStats | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  displayName: string;
  /** True when the session ended WITHOUT the user asking (expired /
   *  refresh failed) — the shell shows a "session expired" notice. */
  sessionExpired: boolean;
  dismissSessionExpired: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

/** Display-name fallback chain: full_name → username → email prefix. */
export function displayName(
  profile: Pick<Profile, "full_name" | "username"> | null,
  email?: string | null
): string {
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  if (profile?.username?.trim()) return profile.username.trim();
  if (email) return email.split("@")[0];
  return "Player";
}

/** Reads the `no_stats` row; returns null when the table doesn't exist yet
 *  (phase 1: no stats table) — never throws. */
async function fetchSudStats(uid: string): Promise<SudStats | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("no_stats")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, number | null>;
    return {
      xp: row.xp ?? 0,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      draws: row.draws ?? 0,
      games_played: row.games_played ?? 0,
      rating: row.rating ?? 800,
      peak_rating: row.peak_rating ?? 800,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SudUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cgStats, setSudStats] = useState<SudStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const explicitSignOutRef = useRef(false);

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, birth_date, city, country")
        .eq("id", uid)
        .single();
      if (data) setProfile(data as Profile);
      setSudStats(await fetchSudStats(uid));
    } catch {
      /* supabase not configured */
    }
  }, []);

  useEffect(() => {
    // Client-side only: never touch Supabase during SSR/prerender.
    let sub: { unsubscribe: () => void } | null = null;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const u = data.session?.user ?? null;
        setUser(u ? { id: u.id, email: u.email ?? undefined } : null);
        if (u) await loadProfile(u.id);
        const { data: s } = supabase.auth.onAuthStateChange(
          (event: string, session: Session | null) => {
            const su = session?.user ?? null;
            if (su) {
              setSessionExpired(false);
              setUser({ id: su.id, email: su.email ?? undefined });
              loadProfile(su.id);
              return;
            }
            if (event === "SIGNED_OUT" && !explicitSignOutRef.current) {
              // A failed token refresh can emit SIGNED_OUT while the
              // stored session is still valid — verify before demoting
              // the player to guest mid-game (games used to record
              // nothing after such a silent downgrade). Only a verified
              // dead session demotes, and it says so out loud.
              void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
                const vu = data.session?.user ?? null;
                if (vu) {
                  setUser({ id: vu.id, email: vu.email ?? undefined });
                  loadProfile(vu.id);
                } else {
                  setUser(null);
                  setProfile(null);
                  setSudStats(null);
                  setSessionExpired(true);
                }
              });
              return;
            }
            explicitSignOutRef.current = false;
            setUser(null);
            setProfile(null);
            setSudStats(null);
          }
        );
        sub = s.subscription;
      } catch {
        /* supabase not configured — stay signed out */
      } finally {
        setLoading(false);
      }
    })();
    return () => sub?.unsubscribe();
  }, [loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const signInWithFacebook = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await createClient().auth.signInWithPassword({
        email,
        password,
      });
      return { error: error ? error.message : null };
    } catch {
      return { error: "Supabase not configured" };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await createClient().auth.signUp({ email, password });
      return { error: error ? error.message : null };
    } catch {
      return { error: "Supabase not configured" };
    }
  }, []);

  const signOut = useCallback(async () => {
    explicitSignOutRef.current = true;
    try {
      await createClient().auth.signOut();
    } catch {
      /* ignore */
    }
  }, []);

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), []);

  const refreshStats = useCallback(async () => {
    if (user) {
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  // loadProfile refreshes both the profile row and the stats.
  const refreshProfile = refreshStats;

  const name = useMemo(() => displayName(profile, user?.email), [profile, user]);

  const value = useMemo(
    () => ({
      user,
      profile,
      cgStats,
      loading,
      signInWithGoogle,
      signInWithFacebook,
      signIn,
      signUp,
      signOut,
      refreshStats,
      refreshProfile,
      displayName: name,
      sessionExpired,
      dismissSessionExpired,
    }),
    [
      user,
      profile,
      cgStats,
      loading,
      signInWithGoogle,
      signInWithFacebook,
      signIn,
      signUp,
      signOut,
      refreshStats,
      name,
      sessionExpired,
      dismissSessionExpired,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
