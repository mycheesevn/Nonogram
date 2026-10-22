"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { handoffUrl } from "@/lib/handoff";

/**
 * A link to another family site (a sibling game or the hub). For
 * guests it behaves exactly like a plain anchor. For signed-in users
 * it first mints a one-time login token (see lib/handoff) so the
 * destination opens already signed in; any failure falls back to the
 * plain URL.
 */
export default function HandoffLink({
  href,
  className,
  style,
  newTab,
  role,
  children,
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  newTab?: boolean;
  role?: string;
  children: ReactNode;
}) {
  const go = async (e: MouseEvent) => {
    let session = null;
    try {
      const { data } = await createClient().auth.getSession();
      session = data.session;
    } catch {
      session = null;
    }
    if (!session) return; // guest — let the anchor navigate normally
    e.preventDefault();
    // Open the tab synchronously so popup blockers don't eat it, then
    // point it at the minted URL once the hand-off answers.
    const win = newTab ? window.open("about:blank", "_blank") : null;
    const url = await handoffUrl(href, session.access_token);
    if (win) {
      win.location.href = url;
    } else {
      window.location.href = url;
    }
  };

  return (
    <a
      href={href}
      className={className}
      style={style}
      role={role}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      onClick={go}
    >
      {children}
    </a>
  );
}
