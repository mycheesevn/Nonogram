"use client";
import React, { useEffect, useRef, useState } from "react";
import PlayView, { type PlayActions } from "./PlayView";
import SiteFooter from "./SiteFooter";
import HowToView from "./HowToView";
import { HistoryView } from "./HistoryView";
import { LeaderboardView } from "./LeaderboardView";
import { StatsView } from "./StatsView";
import { CheckinView } from "./CheckinView";
import QuestsView from "./QuestsView";
import RoomView, { roomErrText } from "./RoomView";
import FriendsView from "./FriendsView";
import { NotificationsView } from "./NotificationsView";
import { PushNudge, PushSettings } from "./PushSettings";
import LibraryView from "./LibraryView";
import { fetchNotifications } from "@/lib/supabase/notifications";
import { AuthModal } from "./AuthModal";
import { ProfileModal } from "./ProfileModal";
import dynamic from "next/dynamic";
import { LiveOverlay, type LivePhase } from "./LiveOverlay";
import type { LiveBroadcaster, LiveDestination } from "@/lib/live/client";

// Lazy: pulls in livekit-client only when the user opens Go Live, keeping
// the main bundle lean for everyone who never streams.
const LiveStreamModal = dynamic(
  () => import("./LiveStreamModal").then((m) => m.LiveStreamModal),
  { ssr: false }
);
import { STR, loadLang, saveLang, type Lang } from "@/lib/nonogram/i18n";
import { isMuted, setMuted } from "@/lib/nonogram/sound";
import { AuthProvider, useAuth } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/client";
import { joinRoom, roomErrorKey } from "@/lib/supabase/rooms";
import { fireEvent } from "@/lib/supabase/notify";
import {
  fetchPendingChallenges,
  respondChallenge,
  sendChallenge,
  subscribeChallenges,
  type Challenge,
} from "@/lib/supabase/friends";

type Mode =
  | "play" | "rooms" | "friends" | "inbox"
  | "library"
  | "history" | "leaderboard" | "stats" | "checkin" | "quests" | "howto";

function Shell() {
  const [lang, setLang] = useState<Lang>(() => loadLang());
  const [mode, setMode] = useState<Mode>("play");
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"in" | "up">("in");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 📡 Go Live — stream the game tab to the player's own YouTube/Facebook
  // via a LiveKit relay. The broadcaster lives here (not in the modal) so
  // the stream survives the modal closing and the page can switch into
  // stream mode (LiveOverlay brand bar + intro/outro cards).
  const [liveOpen, setLiveOpen] = useState(false);
  const [livePhase, setLivePhase] = useState<LivePhase | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState(0);
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const liveBcRef = useRef<LiveBroadcaster | null>(null);
  const liveTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const liveClearTimers = () => {
    liveTimersRef.current.forEach(clearTimeout);
    liveTimersRef.current = [];
  };

  const endLiveNow = async (fromShareEnd: boolean) => {
    liveClearTimers();
    const bc = liveBcRef.current;
    liveBcRef.current = null;
    setLivePhase(null);
    if (bc) await bc.stop();
    if (fromShareEnd) {
      setLiveToast(String(STR[lang].liveShareEnded));
      setTimeout(() => setLiveToast(null), 5000);
    }
  };

  const handleLiveStart = async (destinations: LiveDestination[]) => {
    if (liveBcRef.current) return;
    const { LiveBroadcaster } = await import("@/lib/live/client");
    const bc = new LiveBroadcaster();
    liveBcRef.current = bc;
    bc.onShareEnded = () => {
      void endLiveNow(true);
    };
    try {
      await bc.start(destinations);
    } catch (e) {
      liveBcRef.current = null;
      throw e;
    }
    setLiveStartedAt(Date.now());
    setLivePhase("intro");
    setLiveOpen(false);
    liveTimersRef.current.push(
      setTimeout(() => {
        setLivePhase((p) => (p === "intro" ? "live" : p));
      }, 2000)
    );
  };

  const handleLiveStop = () => {
    if (!liveBcRef.current) return;
    liveClearTimers();
    setLivePhase("outro");
    liveTimersRef.current.push(
      setTimeout(() => {
        void endLiveNow(false);
      }, 2000)
    );
  };

  useEffect(
    () => () => {
      liveClearTimers();
      void liveBcRef.current?.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const actionsRef = useRef<PlayActions | null>(null);
  const [actionsVersion, setActionsVersion] = useState(0);
  const notifyActions = () => setActionsVersion((v) => v + 1);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeToast, setChallengeToast] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  /* Hub deep link ?challenge=<handle>: an OUTGOING challenge to that player. */
  const [hubChallengeHandle, setHubChallengeHandle] = useState<string | null>(null);
  const [hubChallengeTarget, setHubChallengeTarget] = useState<{ id: string; name: string } | null>(null);
  const [hubChallengeBusy, setHubChallengeBusy] = useState(false);
  const [hubChallengeMsg, setHubChallengeMsg] = useState<string | null>(null);
  /** SynerWorlds one-tap login hand-off: ?sso=<magic-link token hash>. */
  const [ssoToken, setSsoToken] = useState<string | null>(null);
  const { user, profile, cgStats, displayName, signOut, sessionExpired, dismissSessionExpired } = useAuth();
  const [expiredMsg, setExpiredMsg] = useState<string | null>(null);
  const s = STR[lang] as Record<string, string | string[]>;
  const userId = user?.id ?? null;

  /* Invite link ?room=CODE → open the rooms mode with the code prefilled. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("room");
    if (code) {
      setInviteCode(code.toUpperCase());
      setMode("rooms");
    }
    // From the SynerWorlds hub (profile page / Tìm đối thủ board):
    // ?challenge=<handle> asks to challenge that player. A 36-char UUID
    // would be an incoming-challenge id (no such handler here) — anything
    // else is a player handle.
    const chl = params.get("challenge");
    if (chl && !/^[0-9a-f-]{36}$/i.test(chl)) {
      setHubChallengeHandle(chl.toLowerCase());
      const u = new URL(window.location.href);
      u.searchParams.delete("challenge");
      window.history.replaceState({}, "", u.toString());
    }
    // From the SynerWorlds hub: ?sso=<magic-link token hash> is a one-time
    // login hand-off. Single-use — strip it so a refresh never retries.
    const sso = params.get("sso");
    if (sso) {
      setSsoToken(sso);
      const u = new URL(window.location.href);
      u.searchParams.delete("sso");
      window.history.replaceState({}, "", u.toString());
    }
  }, []);

  /* Unread inbox badge. */
  const refreshUnread = () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    fetchNotifications()
      .then(({ unread }) => setUnreadCount(unread))
      .catch(() => {});
  };
  useEffect(() => {
    refreshUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* Incoming challenges: initial fetch + realtime subscription. */
  useEffect(() => {
    if (!userId) {
      setChallenge(null);
      return;
    }
    let dead = false;
    fetchPendingChallenges()
      .then(({ incoming }) => {
        if (!dead && incoming.length > 0) setChallenge(incoming[0]);
      })
      .catch(() => {});
    const ch = subscribeChallenges(
      userId,
      (c) => {
        if (!dead) setChallenge(c);
      },
      (name) => {
        if (!dead) {
          setChallengeToast(String(s.challengeDeclinedToast).replace("{name}", name));
          setTimeout(() => setChallengeToast(null), 5000);
        }
      },
      (c, name) => {
        // My challenge was accepted: the accepter is already entering
        // the room — bring me in too, no manual room hunt (user request).
        if (dead) return;
        setChallengeToast(String(s.challengeAcceptedToast).replace("{name}", name));
        setTimeout(() => setChallengeToast(null), 5000);
        if (c.room_id) {
          setOpenRoomId(c.room_id);
          setMode("rooms");
        }
      }
    );
    return () => {
      dead = true;
      try {
        createClient().removeChannel(ch);
      } catch {
        /* ignore */
      }
    };
  }, [userId]);

  const acceptChallenge = async (c: Challenge) => {
    setChallenge(null);
    try {
      // Join FIRST: if the room is full/closed/gone the challenge stays
      // pending (retryable) instead of being silently consumed.
      const room = await joinRoom(c.room_code);
      await respondChallenge(c.id, true).catch(() => {});
      // Notify the challenger (push + inbox) — fired from the accepter's
      // client because the trigger route verifies the caller IS the
      // challenged player; the challenger may not even be online.
      void fireEvent("challenge_accepted", { challenge: c.id });
      setOpenRoomId(room.id);
      setMode("rooms");
    } catch (e) {
      // Never fail silently: explain and keep the challenge actionable.
      setChallengeToast(roomErrText(roomErrorKey(e), s));
      setTimeout(() => setChallengeToast(null), 5000);
      setChallenge(c);
      return;
    }
    try {
      const { incoming } = await fetchPendingChallenges();
      if (incoming.length > 0) setChallenge(incoming[0]);
    } catch {
      /* ignore */
    }
  };

  const declineChallenge = async (c: Challenge) => {
    setChallenge(null);
    try {
      await respondChallenge(c.id, false);
      void fireEvent("challenge_declined", { challenge: c.id });
    } catch {
      /* ignore */
    }
  };

  const pickLang = (l: Lang) => {
    setLang(l);
    saveLang(l);
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    setDrawer(false);
    setMenu(false);
  };
  const openAuth = (m: "in" | "up") => {
    setAuthMode(m);
    setMenu(false);
    setDrawer(false);
    setAuthOpen(true);
  };
  const openLogin = () => openAuth("in");

  /* Hub challenge deep link: prompt login first if needed, resolve the
   * handle to a player, then ask for confirmation before sending. */
  useEffect(() => {
    if (!hubChallengeHandle) return;
    if (!userId) {
      openLogin();
      return;
    }
    let cancelled = false;
    (async () => {
      const sb = createClient();
      const { data } = await sb
        .from("profiles")
        .select("id, full_name, username")
        .eq("handle", hubChallengeHandle)
        .maybeSingle();
      if (cancelled) return;
      setHubChallengeHandle(null);
      if (!data) {
        setHubChallengeMsg(String(s.hubChallengeNotFound));
        return;
      }
      const row = data as { id: string; full_name: string | null; username: string | null };
      if (row.id === userId) return; // own profile link — ignore silently
      const name = row.full_name?.trim() || row.username?.trim() || "Player";
      setHubChallengeTarget({ id: row.id, name });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubChallengeHandle, userId]);

  const doHubChallenge = async () => {
    if (!hubChallengeTarget || hubChallengeBusy) return;
    setHubChallengeBusy(true);
    setHubChallengeMsg(null);
    try {
      const ch = await sendChallenge(hubChallengeTarget.id, displayName);
      setHubChallengeTarget(null);
      // Same entry path as ?room=: the room view joins by invite code.
      if (ch.room_code) {
        setInviteCode(ch.room_code.toUpperCase());
        setMode("rooms");
      }
    } catch {
      setHubChallengeMsg(String(s.hubChallengeError));
    } finally {
      setHubChallengeBusy(false);
    }
  };

  useEffect(() => {
    if (!hubChallengeMsg) return;
    const t = setTimeout(() => setHubChallengeMsg(null), 4500);
    return () => clearTimeout(t);
  }, [hubChallengeMsg]);

  /* Session ended on its own (expired / refresh failed): say so. */
  useEffect(() => {
    if (!sessionExpired) return;
    setExpiredMsg(String(s.sudSessionExpired));
    const t = setTimeout(() => {
      setExpiredMsg(null);
      dismissSessionExpired();
    }, 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpired]);

  // Hub one-tap login: redeem the one-time token; the auth listener picks
  // the session up from there. Failures are said out loud (toast), never
  // swallowed — the player can still sign in manually.
  useEffect(() => {
    if (!ssoToken) return;
    let cancelled = false;
    (async () => {
      const sb = createClient();
      const { error } = await sb.auth.verifyOtp({
        token_hash: ssoToken,
        type: "magiclink",
      });
      if (cancelled) return;
      setSsoToken(null);
      if (error) setHubChallengeMsg(String(s.ssoError));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssoToken]);
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
  };
  /* Drawer mode list — PacClone's order (§4 of the shell spec): play,
     puzzle, library, setup, history, leaderboard, rooms, corr, checkin,
     community. CG extras keep their closest slots: stats rides with the
     leaderboard, howto closes the list. Friends and Notifications are NOT
     in the drawer — they live in the avatar menu. */
  const drawerItems: { key: string; label: string; active: boolean; onPick: () => void }[] = [
    { key: "play", label: `🧩 ${String(s.sudFreePlay)}`, active: mode === "play", onPick: () => pickMode("play") },
    { key: "library", label: String(s.bikip), active: mode === "library", onPick: () => pickMode("library") },
    { key: "history", label: String(s.history), active: mode === "history", onPick: () => pickMode("history") },
    { key: "leaderboard", label: String(s.leaderboard), active: mode === "leaderboard", onPick: () => pickMode("leaderboard") },
    { key: "stats", label: `📊 ${String(s.stats)}`, active: mode === "stats", onPick: () => pickMode("stats") },
    { key: "rooms", label: String(s.room), active: mode === "rooms", onPick: () => pickMode("rooms") },
    { key: "checkin", label: `📅 ${String(s.checkin)}`, active: mode === "checkin", onPick: () => pickMode("checkin") },
    { key: "quests", label: `🎯 ${String(s.noQuestsTitle)}`, active: mode === "quests", onPick: () => pickMode("quests") },
    { key: "howto", label: `📖 ${String(s.howTo)}`, active: mode === "howto", onPick: () => pickMode("howto") },
  ];

  const actions = actionsRef.current;
  void actionsVersion; // re-read actionsRef after PlayView publishes its actions

  /* Settings block shared by both identity menus (PacClone §5): language
     segmented toggle + sound toggle (+ push settings when logged in). */
  const renderSettings = (includePush: boolean) => (
    <div className="sud-account-menu-settings">
      <div className="sud-seg" role="group" aria-label={String(s.language)}>
        <button type="button" className={lang === "vi" ? "active" : ""} onClick={() => pickLang("vi")}>Tiếng Việt</button>
        <button type="button" className={lang === "en" ? "active" : ""} onClick={() => pickLang("en")}>English</button>
      </div>
      <button type="button" className="sud-btn" onClick={toggleMute}>
        {muted ? "🔇" : "🔊"} {String(s.sound)}
      </button>
      {includePush && <PushSettings lang={lang} />}
    </div>
  );

  return (
    <div className="sud-page">
      <header className="sud-header">
        <div className="sud-topbar">
          <button className="sud-menu-btn" aria-label="Menu" onClick={() => setDrawer(true)}>☰</button>
          <div className="sud-brand">
            <h1 className="sud-title">{String(s.appName)}</h1>
            <span className="no-muted">{String(s.tagline)}</span>
          </div>
          <div className="sud-account">
            <div className="sud-user" role="group" aria-label="Account">
            {user && (
              <button className="sud-rating-chip" onClick={() => pickMode("leaderboard")} title={String(s.leaderboard)}>
                ⭐ {cgStats?.rating ?? 800}
              </button>
            )}
            {user ? (
              <button
                className="sud-avatar-btn"
                aria-label={displayName}
                onClick={() => setMenu((m) => !m)}
              >
                <span className="sud-account-avatar">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt="" />
                  ) : (
                    (displayName || "P").slice(0, 1).toUpperCase()
                  )}
                </span>
                {unreadCount > 0 && <span className="sud-avatar-dot" aria-label={String(unreadCount)} />}
              </button>
            ) : (
              <button className="sud-gear-btn" aria-label={String(s.settings)} onClick={() => setMenu((m) => !m)}>⚙️</button>
            )}
            {menu && (
              <>
                <div className="sud-menu-backdrop" onClick={() => setMenu(false)} />
                <div className="sud-account-menu" role="menu">
                  {user ? (
                    <>
                      <div className="sud-account-menu-head">
                        <span className="sud-account-avatar large">
                          {profile?.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={profile.avatar_url} alt="" />
                          ) : (
                            "👤"
                          )}
                        </span>
                        <div className="sud-account-menu-id">
                          <strong>{displayName}</strong>
                          <span className="no-muted">{user.email}</span>
                        </div>
                      </div>
                      <button className="sud-btn" onClick={() => { setMenu(false); setProfileOpen(true); }}>
                        {String(s.profile)}
                      </button>
                      <button className="sud-btn" onClick={() => pickMode("inbox")}>
                        {String(s.notifications)}
                        {unreadCount > 0 && (
                          <span className="sud-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                        )}
                      </button>
                      <button className="sud-btn" onClick={() => pickMode("friends")}>
                        {String(s.friends)}
                      </button>
                      <button
                        className="sud-btn"
                        onClick={() => setSettingsOpen((o) => !o)}
                        aria-expanded={settingsOpen}
                      >
                        ⚙️ {String(s.settings)} {settingsOpen ? "▾" : "▸"}
                      </button>
                      {settingsOpen && renderSettings(true)}
                      <button
                        className="sud-btn"
                        onClick={async () => { setMenu(false); await signOut(); }}
                      >
                        🚪 {String(s.logout)}
                      </button>
                    </>
                  ) : (
                    <>
                      {renderSettings(false)}
                      <button className="sud-btn sud-btn-primary" onClick={() => openAuth("in")}>
                        🔑 {String(s.login)}
                      </button>
                      <button className="sud-btn" onClick={() => openAuth("up")}>
                        {String(s.authSignup)}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            </div>
          </div>
        </div>
        {mode === "play" && (
          <div className="sud-quick">
            <button type="button" className="sud-btn" disabled={!actions?.canUndo} onClick={() => actions?.undo()}>
              {String(s.undo)}
            </button>
            <button type="button" className="sud-btn" disabled={!actions?.canHint} onClick={() => actions?.hint()}>
              {actions?.hintThinking ? String(s.hintThinking) : String(s.hint)}
            </button>
            <span className="sud-quick-spacer" />
            <button type="button" className="sud-btn sud-btn-primary" onClick={() => actions?.newGame()}>
              {String(s.newGame)}
            </button>
          </div>
        )}
      </header>

      {drawer && (
        <div className="sud-drawer-root">
          <div className="sud-backdrop" onClick={() => setDrawer(false)} />
          <nav className="sud-drawer" aria-label="Modes">
            <div className="sud-drawer-head">
              <strong>{String(s.menu)}</strong>
              <button className="sud-btn-icon" aria-label={String(s.close)} onClick={() => setDrawer(false)}>✕</button>
            </div>
            <div className="sud-drawer-body">
              <section>
                <h2>{String(s.mode)}</h2>
                <div className="sud-drawer-modes">
                  {drawerItems.map((m) => (
                    <button
                      key={m.key}
                      className={`sud-btn${m.active ? " sud-btn-primary" : ""}`}
                      onClick={m.onPick}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2>{String(s.guides)}</h2>
                <div className="sud-drawer-modes">
                  <a href="https://synerworlds.com/blog?cat=nonogram" className="sud-blog-drawer-link">
                    {String(s.guides)}
                  </a>
                </div>
              </section>
              <section>
                <h2>{String(s.liveTitle)}</h2>
                <div className="sud-drawer-modes">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawer(false);
                      setLiveOpen(true);
                    }}
                  >
                    {String(s.liveMenu)}
                  </button>
                </div>
              </section>
              <div className="sud-drawer-legal">
                <a href="/terms" target="_blank" rel="noreferrer">{String(s.termsOfService)}</a>
                <span> · </span>
                <a href="/privacy" target="_blank" rel="noreferrer">{String(s.privacyPolicy)}</a>
                <span> · </span>
                <a href="/data-deletion" target="_blank" rel="noreferrer">{String(s.dataDeletion)}</a>
              </div>
            </div>
          </nav>
        </div>
      )}

      {challenge && (
        <div className="sud-challenge-banner" role="alert">
          <span>
            {String(s.challengeFrom).replace("{name}", challenge.challenger_name ?? "…")}
          </span>
          <button type="button" className="sud-btn small sud-btn-primary" onClick={() => void acceptChallenge(challenge)}>
            {String(s.challengeAccept)}
          </button>
          <button type="button" className="sud-btn small" onClick={() => void declineChallenge(challenge)}>
            {String(s.challengeDecline)}
          </button>
        </div>
      )}
      {challengeToast && <div className="sud-challenge-toast">{challengeToast}</div>}
      {liveToast && <div className="sud-challenge-toast">{liveToast}</div>}
      {expiredMsg && <div className="sud-challenge-toast">{expiredMsg}</div>}
      {hubChallengeTarget && (
        <div className="sud-modal-root" onClick={() => !hubChallengeBusy && setHubChallengeTarget(null)}>
          <div className="sud-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{String(s.hubChallengeTitle).replace("{name}", hubChallengeTarget.name)}</h2>
            {hubChallengeMsg && (
              <p style={{ color: "var(--red, #d4382c)", margin: "0 0 8px" }} role="alert">
                {hubChallengeMsg}
              </p>
            )}
            <div className="sud-modal-actions">
              <button
                type="button"
                className="sud-btn sud-btn-primary"
                disabled={hubChallengeBusy}
                onClick={() => void doHubChallenge()}
              >
                {String(s.hubChallengeSend)}
              </button>
              <button
                type="button"
                className="sud-btn"
                disabled={hubChallengeBusy}
                onClick={() => setHubChallengeTarget(null)}
              >
                {String(s.hubChallengeLater)}
              </button>
            </div>
          </div>
        </div>
      )}
      {hubChallengeMsg && !hubChallengeTarget && (
        <div className="sud-challenge-toast">{hubChallengeMsg}</div>
      )}
      {user && <PushNudge lang={lang} />}

        {mode === "play" && (
          <PlayView
            lang={lang}
            user={user}
            onLogin={openLogin}
            actionsRef={actionsRef}
            notifyActions={notifyActions}
          />
        )}
        {mode === "rooms" && (
          <RoomView
            lang={lang}
            user={user}
            inviteCode={inviteCode}
            onConsumeInvite={() => setInviteCode(null)}
            onLogin={openLogin}
            openRoomId={openRoomId}
          />
        )}
        {mode === "friends" &&
          (user ? (
            <FriendsView
              lang={lang}
              userId={user.id}
              myName={displayName}
              onAcceptChallenge={acceptChallenge}
            />
          ) : (
            <div className="sud-scroll-area">
              <div className="sud-view">
                <h2>{String(s.friends)}</h2>
                <div className="sud-panel">
                  <p className="sud-hint">{String(s.loginToViewHistory)}</p>
                  <button type="button" className="sud-btn sud-btn-primary" onClick={openLogin}>
                    {String(s.login)}
                  </button>
                </div>
              </div>
            </div>
          ))}
        {mode === "inbox" && <NotificationsView lang={lang} onChanged={refreshUnread} />}
        {mode === "library" && <LibraryView lang={lang} userId={userId} />}
        {mode === "history" && <HistoryView lang={lang} user={user} onLogin={openLogin} />}
        {mode === "leaderboard" && <LeaderboardView lang={lang} myUserId={user?.id ?? null} />}
        {mode === "stats" && <StatsView lang={lang} />}
        {mode === "checkin" && <CheckinView lang={lang} user={user} onLogin={openLogin} />}
        {mode === "quests" && <QuestsView lang={lang} user={user} onLogin={openLogin} />}
        {mode === "howto" && <HowToView lang={lang} />}
      <SiteFooter lang={lang} className="sud-footer" />

      <AuthModal lang={lang} open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
      <ProfileModal lang={lang} open={profileOpen} onClose={() => setProfileOpen(false)} />
      {liveOpen && (
        <LiveStreamModal
          lang={lang}
          onClose={() => setLiveOpen(false)}
          onRequireLogin={() => {
            setLiveOpen(false);
            openAuth("in");
          }}
          onStart={handleLiveStart}
        />
      )}
      {livePhase && (
        <LiveOverlay
          lang={lang}
          phase={livePhase}
          startedAt={liveStartedAt}
          onStop={handleLiveStop}
        />
      )}
    </div>
  );
}

export default function AppShell() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
