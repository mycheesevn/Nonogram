"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { STR, type Lang } from "@/lib/nonogram/i18n";

interface Props {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** Which tab the modal opens on (the modal stays internally switchable). */
  initialMode?: "in" | "up";
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z"
      />
    </svg>
  );
}

export function AuthModal({ lang, open, onClose, initialMode = "in" }: Props) {
  const dict = STR[lang] as Record<string, string | string[]>;
  /** i18n lookup with a hardcoded fallback so the modal works even before
   *  the parent adds these keys to i18n.ts. */
  const t = (k: string, fb: string): string => {
    const v = dict[k];
    return typeof v === "string" ? v : fb;
  };
  const { signUp, signIn, signInWithGoogle, signInWithFacebook } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Opening the modal honours the requested initial tab.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
      setDone(null);
    }
  }, [open, initialMode]);

  if (!open) return null;

  const signInLabel = t("authSignIn", lang === "vi" ? "Đăng nhập" : "Sign in");
  const signUpLabel = t("authSignUp", lang === "vi" ? "Đăng ký" : "Sign up");

  const oauth = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      /* redirect flow failed */
    }
    setBusy(false);
    // On success the browser redirects to the provider, so nothing else to do.
  };

  const submit = async () => {
    if (!email.includes("@") || password.length < 6) {
      setError(
        t(
          "authError",
          lang === "vi"
            ? "Email hoặc mật khẩu không hợp lệ (mật khẩu ≥ 6 ký tự)."
            : "Invalid email or password (min 6 characters)."
        )
      );
      return;
    }
    setBusy(true);
    setError(null);
    const fn = mode === "in" ? signIn : signUp;
    const { error: err } = await fn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(err);
    } else if (mode === "up") {
      setDone(
        t(
          "authCheckEmail",
          lang === "vi"
            ? "Đăng ký thành công! Hãy kiểm tra email để xác nhận tài khoản."
            : "Signed up! Please check your email to confirm your account."
        )
      );
    } else {
      onClose();
    }
  };

  return (
    <div className="sud-modal-root" onClick={onClose}>
      <div className="sud-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {t("appName", "Nonogram")} — {t("authTitle", mode === "in" ? signInLabel : signUpLabel)}
        </h2>
        <div className="sud-mode-toggle">
          <button
            type="button"
            className={`sud-btn${mode === "in" ? " active" : ""}`}
            onClick={() => {
              setMode("in");
              setError(null);
              setDone(null);
            }}
          >
            {signInLabel}
          </button>
          <button
            type="button"
            className={`sud-btn${mode === "up" ? " active" : ""}`}
            onClick={() => {
              setMode("up");
              setError(null);
              setDone(null);
            }}
          >
            {signUpLabel}
          </button>
        </div>
        <div className="sud-oauth">
          <button
            type="button"
            className="sud-btn sud-oauth-btn"
            onClick={() => oauth(signInWithGoogle)}
            disabled={busy}
          >
            <GoogleIcon /> {t("authContinueWith", lang === "vi" ? "Tiếp tục với" : "Continue with")} Google
          </button>
          <button
            type="button"
            className="sud-btn sud-oauth-btn"
            onClick={() => oauth(signInWithFacebook)}
            disabled={busy}
          >
            <FacebookIcon /> {t("authContinueWith", lang === "vi" ? "Tiếp tục với" : "Continue with")} Facebook
          </button>
        </div>
        <div className="sud-or" />
        <label className="sud-field">
          <span>{t("authEmail", "Email")}</span>
          <input
            type="email"
            className="sud-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="sud-field">
          <span>{t("authPassword", lang === "vi" ? "Mật khẩu" : "Password")}</span>
          <input
            type="password"
            className="sud-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>
        {error && <p className="sud-error">{error}</p>}
        {done && <p className="sud-ok">{done}</p>}
        <div className="sud-buttons">
          <button
            type="button"
            className="sud-btn sud-btn-primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "…" : t("authSubmit", mode === "in" ? signInLabel : signUpLabel)}
          </button>
          <button type="button" className="sud-btn" onClick={onClose}>
            {t("close", lang === "vi" ? "Đóng" : "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
