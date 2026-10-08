"use client";
import { AccountMenu } from "./account/AccountMenu.js";
import { useAccount } from "./account/session.js";
import { useNav } from "./nav.js";
import { useT } from "./settings.js";

export type Section = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings" | "help" | "stats" | "account" | "privacy" | "terms";

const ITEMS: { id: Section; path: string; en: string; zh: string }[] = [
  { id: "learn", path: "/learn", en: "Learn", zh: "学习" },
  { id: "puzzles", path: "/puzzles", en: "Puzzles", zh: "题目" },
  { id: "bots", path: "/bots", en: "Play bots", zh: "人机对弈" },
  { id: "analysis", path: "/analysis", en: "Analysis", zh: "分析" },
  { id: "play", path: "/play", en: "Two players", zh: "双人对弈" },
];

/** Site header: logo, sections, settings and a language switch. */
export function SiteNav({ current, languageHref }: { current: Section; languageHref?: string }) {
  const nav = useNav();
  const { tt, lang } = useT();
  // Signed in, My stats and Settings move into the account menu.
  const signedIn = useAccount().state.status === "signedIn";
  return (
    <nav className="topnav" aria-label={tt("Main", "主菜单")}>
      <a className="brand" href={nav.href("/")}>
        <span aria-hidden>象棋</span> Xiangqi
      </a>
      <div className="topnav-links">
        {ITEMS.map((i) => (
          <a key={i.id} href={nav.href(i.path)} aria-current={current === i.id ? "page" : undefined}>
            {lang === "zh" ? i.zh : i.en}
          </a>
        ))}
      </div>
      <div className="topnav-right">
        {languageHref && (
          <a href={languageHref} hrefLang={lang === "zh" ? "en" : "zh"} lang={lang === "zh" ? "en" : "zh"}>
            {lang === "zh" ? "English" : "中文"}
          </a>
        )}
        {!signedIn && (
          <a href={nav.href("/stats")} aria-current={current === "stats" ? "page" : undefined}>
            {tt("My stats", "我的统计")}
          </a>
        )}
        <a href={nav.href("/help")} aria-current={current === "help" ? "page" : undefined}>
          {tt("Help", "帮助")}
        </a>
        {!signedIn && (
          <a href={nav.href("/settings")} aria-current={current === "settings" ? "page" : undefined}>
            {tt("Settings", "设置")}
          </a>
        )}
        <AccountMenu />
      </div>
    </nav>
  );
}
