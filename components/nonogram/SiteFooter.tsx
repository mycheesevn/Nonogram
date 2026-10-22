/**
 * Shared SynerWorlds footer — identical content on every family site
 * (mirrors the hub footer at synerworlds.com): brand line, the family
 * game line, legal links (hosted on the hub) and the SynerWork
 * copyright. Links open in a new tab so a game in progress is never
 * lost by an accidental tap, and they are HandoffLinks: a signed-in
 * player arrives at the destination already signed in (full-mesh SSO).
 */

import FooterGames from "./FooterGames";
import HandoffLink from "./HandoffLink";

const GAMES: Array<{ vi: string; en: string; url: string }> = [
  { vi: "Cờ tướng", en: "Xiangqi", url: "https://cotuong.synerworlds.com" },
  { vi: "cờ vua", en: "Chess", url: "https://chess.synerworlds.com" },
  {
    vi: "cờ chiếu tướng",
    en: "Vietnamese General Check",
    url: "https://cochieutuong.synerworlds.com",
  },
  { vi: "cờ gánh", en: "Co Ganh", url: "https://coganh.synerworlds.com" },
  { vi: "cờ nhào", en: "Co Nhao", url: "https://conhao.synerworlds.com" },
  { vi: "cờ cá ngựa", en: "Ca Ngua", url: "https://cangua.synerworlds.com" },
  { vi: "ô ăn quan", en: "O An Quan", url: "https://oanquan.synerworlds.com" },
  { vi: "cờ vây", en: "Go", url: "https://covay.synerworlds.com" },
  { vi: "Sudoku", en: "Sudoku", url: "https://sudoku.synerworlds.com" },
  {
    vi: "Cross Words",
    en: "Cross Words",
    url: "https://crosswords.synerworlds.com",
  },
  {
    vi: "Word Search",
    en: "Word Search",
    url: "https://wordsearch.synerworlds.com",
  },
  { vi: "cờ đam", en: "Checkers", url: "https://checkers.synerworlds.com" },
  { vi: "cờ ca-rô", en: "Gomoku", url: "https://cocaro.synerworlds.com" },
  { vi: "cờ úp 🃏", en: "Dark Xiangqi 🃏", url: "https://cotuongup.synerworlds.com" },
  { vi: "Nonogram", en: "Nonogram", url: "https://nonogram.synerworlds.com" },
];

const HUB = "https://synerworlds.com";

export default function SiteFooter({
  lang,
  className,
}: {
  lang: "vi" | "en";
  className: string;
}) {
  const en = lang === "en";
  const q = en ? "?lang=en" : "";
  const linkStyle = { color: "inherit" } as const;
  return (
    <footer
      className={className}
      style={{
        lineHeight: 1.55,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 16,
        rowGap: 0,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        <HandoffLink href={HUB} newTab style={linkStyle}>
          {en
            ? "SynerWorlds - One account, every world."
            : "SynerWorlds - Một tài khoản, mọi bàn cờ."}
        </HandoffLink>
      </div>
      <div>
        <FooterGames lang={lang} fallback={GAMES} linkStyle={linkStyle} />
      </div>
      <div>
        <HandoffLink href={`${HUB}/terms${q}`} newTab style={linkStyle}>
          {en ? "Terms of Service" : "Điều khoản dịch vụ"}
        </HandoffLink>
        {" · "}
        <HandoffLink href={`${HUB}/privacy${q}`} newTab style={linkStyle}>
          {en ? "Privacy Policy" : "Chính sách bảo mật"}
        </HandoffLink>
        {" · "}
        <HandoffLink href={`${HUB}/contact${q}`} newTab style={linkStyle}>
          {en ? "Contact" : "Liên hệ"}
        </HandoffLink>
        {" · "}
        <HandoffLink href={`${HUB}/blog${q}`} newTab style={linkStyle}>
          Blog
        </HandoffLink>
        {" · "}
        {en
          ? "© SynerWork Inc. All rights reserved."
          : "© SynerWork Inc. Bảo lưu mọi quyền."}
      </div>
    </footer>
  );
}
