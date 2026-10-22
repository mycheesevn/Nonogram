"use client";

import { useEffect, useRef, useState } from "react";
import { displayName, useAuth } from "@/lib/supabase/auth";
import {
  changePassword,
  updateMyProfile,
  uploadAvatar,
} from "@/lib/supabase/profile";
import { APP_HOST, renderShareCard, sharePng } from "@/lib/nonogram/shareCard";
import { STR, type Lang } from "@/lib/nonogram/i18n";

interface Props {
  lang: Lang;
  open: boolean;
  onClose: () => void;
}

/** Editable profile (PacClone/Chess parity): avatar upload, full name,
 *  birth date, city, country; username + email read-only; stats; share
 *  card; change password. The profile row lives on the SHARED profiles
 *  table, so edits show up across all the family's games. */
export function ProfileModal({ lang, open, onClose }: Props) {
  const dict = STR[lang] as Record<string, string | string[]>;
  const t = (k: string, fb: string): string => {
    const v = dict[k];
    return typeof v === "string" ? v : fb;
  };
  const { user, profile, cgStats, loading, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Seed the form from the profile row each time the modal opens.
  useEffect(() => {
    if (!open || !profile) return;
    setFullName(profile.full_name ?? "");
    setBirthDate(profile.birth_date ?? "");
    setCity(profile.city ?? "");
    setCountry(profile.country ?? "");
    setMsg("");
    setPwMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id]);

  if (!open) return null;
  if (!user) return null;

  const name = displayName(profile, user.email);
  const initial = (name.trim()[0] ?? "👤").toUpperCase();
  const s = cgStats;

  const stat = (value: number, key: string, fb: string) => (
    <div className="sud-profile-stat" key={key}>
      <b>{value}</b>
      <span>{t(key, fb)}</span>
    </div>
  );

  const onPickAvatar = async (file: File | null) => {
    if (!file || uploading) return;
    setUploading(true);
    setMsg("");
    const { url, error } = await uploadAvatar(file);
    if (error || !url) {
      setMsg(t("profileSaveError", lang === "vi" ? "Lưu không thành công" : "Save failed"));
    } else {
      await updateMyProfile({ avatar_url: url });
      await refreshProfile();
    }
    setUploading(false);
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setMsg("");
    const err = await updateMyProfile({
      full_name: fullName.trim() || null,
      birth_date: birthDate || null,
      city: city.trim() || null,
      country: country.trim() || null,
    });
    setSaving(false);
    if (err) {
      setMsg(t("profileSaveError", lang === "vi" ? "Lưu không thành công, thử lại nhé" : "Could not save"));
    } else {
      await refreshProfile();
      setMsg(t("profileSaved", lang === "vi" ? "Đã lưu hồ sơ!" : "Profile saved!"));
    }
  };

  const onShare = async () => {
    try {
      const blob = await renderShareCard({
        state: null,
        headline: name,
        subline:
          lang === "vi"
            ? `⭐ ${s?.xp ?? 0} XP · ${s?.wins ?? 0} thắng / ${s?.games_played ?? 0} ván`
            : `⭐ ${s?.xp ?? 0} XP · ${s?.wins ?? 0} wins / ${s?.games_played ?? 0} games`,
        appName: lang === "vi" ? "Nonogram" : "Ca Ngua",
        appUrl: APP_HOST,
      });
      await sharePng(blob, t("profileTitle", "Profile"), name);
    } catch {
      /* best-effort */
    }
  };

  const onChangePassword = async () => {
    if (pwBusy) return;
    setPwMsg("");
    if (pw1.length < 6) {
      setPwMsg(t("profilePasswordShort", lang === "vi" ? "Mật khẩu cần ít nhất 6 ký tự" : "Password needs at least 6 characters"));
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg(t("profilePasswordMismatch", lang === "vi" ? "Mật khẩu nhập lại không khớp" : "Passwords do not match"));
      return;
    }
    setPwBusy(true);
    const err = await changePassword(pw1);
    setPwBusy(false);
    if (err) {
      setPwMsg(err);
    } else {
      setPw1("");
      setPw2("");
      setPwMsg(t("profilePasswordChanged", lang === "vi" ? "Đã đổi mật khẩu!" : "Password changed!"));
    }
  };

  return (
    <div className="sud-modal-root" onClick={onClose}>
      <div
        className="sud-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="👤"
      >
        <div className="sud-profile-head">
          <h2>👤 {t("profileTitle", lang === "vi" ? "Hồ sơ của bạn" : "Your profile")}</h2>
          <button
            type="button"
            className="sud-btn sud-btn-icon"
            onClick={onClose}
            aria-label={t("close", lang === "vi" ? "Đóng" : "Close")}
          >
            ✕
          </button>
        </div>
        {loading ? (
          <p className="no-muted" style={{ textAlign: "center" }}>
            …
          </p>
        ) : (
          <>
            <div className="sud-profile-avatar">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" />
              ) : (
                initial
              )}
            </div>
            <div style={{ textAlign: "center" }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="sud-btn small"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? t("profileUploading", "Đang tải…")
                  : `📷 ${t("profileChangeAvatar", lang === "vi" ? "Đổi ảnh" : "Change photo")}`}
              </button>
            </div>
            <div className="sud-profile-name">{name}</div>
            {user.email && <div className="sud-profile-email">{user.email}</div>}

            <div className="sud-profile-stats">
              {stat(s?.rating ?? 800, "profileRating", "Rating")}
              {stat(s?.xp ?? 0, "profileXp", "XP")}
              {stat(s?.wins ?? 0, "profileWins", lang === "vi" ? "Thắng" : "Wins")}
              {stat(s?.losses ?? 0, "profileLosses", lang === "vi" ? "Thua" : "Losses")}
              {stat(s?.draws ?? 0, "profileDraws", lang === "vi" ? "Hòa" : "Draws")}
              {stat(
                s?.games_played ?? 0,
                "profileGames",
                lang === "vi" ? "Ván" : "Games"
              )}
            </div>

            <div className="sud-profile-form">
              <label className="sud-field">
                {t("profileFullName", lang === "vi" ? "Họ tên" : "Full name")}
                <input
                  className="sud-input"
                  value={fullName}
                  maxLength={60}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </label>
              <label className="sud-field">
                {t("profileBirthDate", lang === "vi" ? "Ngày sinh" : "Date of birth")}
                <input
                  className="sud-input"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </label>
              <label className="sud-field">
                {t("profileCity", lang === "vi" ? "Thành phố" : "City")}
                <input
                  className="sud-input"
                  value={city}
                  maxLength={60}
                  onChange={(e) => setCity(e.target.value)}
                />
              </label>
              <label className="sud-field">
                {t("profileCountry", lang === "vi" ? "Quốc gia" : "Country")}
                <input
                  className="sud-input"
                  value={country}
                  maxLength={60}
                  onChange={(e) => setCountry(e.target.value)}
                />
              </label>
              <label className="sud-field">
                {t("profileUsername", lang === "vi" ? "Tên đăng nhập" : "Username")}
                <input
                  className="sud-input"
                  value={profile?.username ?? ""}
                  readOnly
                  disabled
                />
              </label>
              <label className="sud-field">
                {t("profileEmail", "Email")}
                <input
                  className="sud-input"
                  value={user.email ?? ""}
                  readOnly
                  disabled
                />
              </label>
            </div>
            {msg && <p className="sud-profile-msg">{msg}</p>}
            <div className="sud-buttons">
              <button
                type="button"
                className="sud-btn sud-btn-primary"
                onClick={onSave}
                disabled={saving || uploading}
              >
                {t("profileSave", lang === "vi" ? "Lưu hồ sơ" : "Save profile")}
              </button>
              <button type="button" className="sud-btn" onClick={onShare}>
                {t("profileShareCard", "📤 Khoe card")}
              </button>
            </div>

            <div className="sud-profile-section">
              <h3>{t("profileChangePassword", "🔑 Đổi mật khẩu")}</h3>
              <div className="sud-profile-form">
                <label className="sud-field">
                  {t("profileNewPassword", lang === "vi" ? "Mật khẩu mới" : "New password")}
                  <input
                    className="sud-input"
                    type="password"
                    value={pw1}
                    autoComplete="new-password"
                    onChange={(e) => setPw1(e.target.value)}
                  />
                </label>
                <label className="sud-field">
                  {t("profileConfirmPassword", lang === "vi" ? "Nhập lại mật khẩu mới" : "Repeat new password")}
                  <input
                    className="sud-input"
                    type="password"
                    value={pw2}
                    autoComplete="new-password"
                    onChange={(e) => setPw2(e.target.value)}
                  />
                </label>
              </div>
              {pwMsg && <p className="sud-profile-msg">{pwMsg}</p>}
              <div className="sud-buttons">
                <button
                  type="button"
                  className="sud-btn"
                  onClick={onChangePassword}
                  disabled={pwBusy || !pw1 || !pw2}
                >
                  {t("profileChangePassword", "🔑 Đổi mật khẩu")}
                </button>
                <button type="button" className="sud-btn" onClick={onClose}>
                  {t("close", lang === "vi" ? "Đóng" : "Close")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
