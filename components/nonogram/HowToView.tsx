"use client";

/** How to play Nonogram — five short sections (i18n sudHowto* keys). */
import React from "react";
import { STR, type Lang } from "@/lib/nonogram/i18n";

export default function HowToView({ lang }: { lang: Lang }) {
  const s = STR[lang] as Record<string, string | string[]>;
  const sections: [string, string][] = [
    [String(s.sudHowto1Title), String(s.sudHowto1Text)],
    [String(s.sudHowto2Title), String(s.sudHowto2Text)],
    [String(s.sudHowto3Title), String(s.sudHowto3Text)],
    [String(s.sudHowto4Title), String(s.sudHowto4Text)],
    [String(s.sudHowto5Title), String(s.sudHowto5Text)],
  ];
  return (
    <div className="sud-scroll-area">
      <div className="sud-view">
        <h2>📖 {String(s.howTo)}</h2>
        {sections.map(([title, text]) => (
          <div className="sud-panel" key={title}>
            <h3>{title}</h3>
            <p className="sud-note">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
