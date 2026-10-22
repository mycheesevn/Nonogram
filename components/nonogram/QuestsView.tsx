"use client";

/** Beginner quests — three one-time +20 XP quests (play a game, win
 *  a game, join a room). Completion is verified server-side by
 *  no_claim_quest; this view only lists and claims. */
import { useEffect, useState } from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";
import { QUESTS, claimQuest, claimedQuests } from "@/lib/supabase/quests";

interface Props {
  lang: Lang;
  user: { id: string } | null;
  onLogin: () => void;
}

export default function QuestsView({ lang, user, onLogin }: Props) {
  const s = STR[lang] as Record<string, string | string[]>;
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!user) return;
    claimedQuests()
      .then(setClaimed)
      .catch(() => {});
  }, [user]);

  const labels: Record<string, string> = {
    play_1: String(s.noQuestPlay1),
    win_1: String(s.noQuestWin1),
    join_room: String(s.noQuestJoinRoom),
  };

  if (!user) {
    return (
      <div className="sud-view">
        <h2>🎯 {String(s.noQuestsTitle)}</h2>
        <p className="sud-hint">{String(s.noQuestLogin)}</p>
        <button type="button" className="sud-btn sud-btn-primary" onClick={onLogin}>
          🔑 {String(s.login)}
        </button>
      </div>
    );
  }

  const doClaim = async (id: string) => {
    setMsg("");
    try {
      const ok = await claimQuest(id);
      if (ok) {
        setClaimed(new Set(claimed).add(id));
        setMsg(String(s.noQuestClaimed));
      } else {
        setMsg(String(s.noQuestNotYet));
      }
    } catch {
      setMsg(String(s.noQuestError));
    }
  };

  return (
    <div className="sud-view">
      <h2>🎯 {String(s.noQuestsTitle)}</h2>
      {msg && <p className="sud-note">{msg}</p>}
      <ul className="sud-lb-list">
        {QUESTS.map((q) => {
          const done = claimed.has(q.id);
          return (
            <li key={q.id} className="sud-lb-row">
              <span className="sud-lb-name">{labels[q.id] ?? q.id}</span>
              <span className="sud-hint">+{q.xp} XP</span>
              <button
                type="button"
                className="sud-btn small"
                disabled={done}
                onClick={() => void doClaim(q.id)}
              >
                {done ? "✓" : String(s.noQuestClaim)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
