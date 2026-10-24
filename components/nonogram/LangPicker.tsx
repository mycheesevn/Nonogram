"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LocaleInfo } from "@/lib/nonogram/i18nCentral";

/** 🌐 Language picker — the family's shared pattern (piloted on Sudoku).
 *  A compact header button (globe + current locale code) opens a panel
 *  with the central loader's available locales under their NATIVE
 *  names: a popover anchored to the header cluster on desktop, a
 *  bottom sheet on mobile (CSS-driven). The list order follows the
 *  hub's rule: the current locale first, English second, the rest in
 *  manifest order. The search box keeps the list usable as the hub
 *  store grows. Picking a locale goes through AppShell's pickLang —
 *  the existing preference write + loader apply path, no parallel
 *  mechanism. */
export function LangPicker({
  lang,
  locales,
  label,
  closeLabel,
  onPick,
}: {
  lang: string;
  locales: LocaleInfo[];
  label: string;
  closeLabel: string;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open ]);

  const ordered = useMemo(() => {
    const cur = locales.filter((l) => l.code === lang);
    const en = locales.filter((l) => l.code === "en" && l.code !== lang);
    const rest = locales.filter((l) => l.code !== lang && l.code !== "en");
    return [...cur, ...en, ...rest];
  }, [locales, lang]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }, [ordered, query]);

  const pick = (code: string) => {
    setOpen(false);
    onPick(code);
  };

  return (
    <>
      <button
        type="button"
        className="sud-lang-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        🌐 <span>{lang.toUpperCase()}</span>
      </button>
      {open && (
        <>
          <div className="sud-lang-backdrop" onClick={() => setOpen(false)} />
          <div className="sud-lang-pop" role="dialog" aria-modal="true" aria-label={label}>
            <div className="sud-lang-pop-head">
              <span>🌐 {label}</span>
              <button
                type="button"
                className="sud-lang-close"
                aria-label={closeLabel}
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <input
              ref={inputRef}
              className="sud-lang-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${label}…`}
              aria-label={label}
            />
            <div className="sud-lang-list" role="listbox" aria-label={label}>
              {shown.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={l.code === lang}
                  className={`sud-lang-item${l.code === lang ? " active" : ""}`}
                  onClick={() => pick(l.code)}
                >
                  <span className="sud-lang-name">{l.name}</span>
                  <span className="sud-lang-tag">
                    {l.code.toUpperCase()}
                    {l.code === lang ? " ✓" : ""}
                  </span>
                </button>
              ))}
              {shown.length === 0 && <div className="sud-lang-empty">—</div>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
