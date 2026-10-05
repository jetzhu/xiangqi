import type { Metadata } from "next";

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (s: string): s is Locale => (LOCALES as readonly string[]).includes(s);

/** Public address of the site (set NEXT_PUBLIC_SITE_URL at build time once the domain is chosen). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://xiangqi.example").replace(/\/$/, "");
/**
 * Where the site lives under its domain: "" at the root, "/xiangqi" for a GitHub Pages project site.
 * Next adds it to its own assets; plain links and static files go through `withBase`.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
export const withBase = (path: string) => `${BASE_PATH}${path}`;
/** Hosts that cannot send COOP/COEP headers (GitHub Pages) get them from a service worker instead. */
export const COI_SERVICE_WORKER = process.env.NEXT_PUBLIC_COI_SERVICE_WORKER === "1";
export const SITE_NAME = { zh: "象棋学堂", en: "Xiangqi School" } as const;

type PageKey = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings";
const PAGES: Record<PageKey, { path: string; title: Record<Locale, string>; description: Record<Locale, string> }> = {
  home: {
    path: "/",
    title: { zh: "学象棋，下象棋", en: "Learn and play Xiangqi (Chinese chess)" },
    description: {
      zh: "免费学习中国象棋：互动课程、象棋题目、人机对弈和分析引擎，在浏览器里就能用。",
      en: "Learn Xiangqi (Chinese chess) for free: interactive lessons, puzzles, bots and an analysis engine, right in your browser.",
    },
  },
  learn: {
    path: "/learn",
    title: { zh: "象棋入门课程", en: "Learn Xiangqi: lessons for beginners" },
    description: {
      zh: "从认识棋盘到第一盘棋：11个互动小课，学会每个棋子的走法、将军与将死、特殊规则。",
      en: "From the board to your first game: 11 interactive lessons on every piece, check and checkmate, and the special rules of Xiangqi.",
    },
  },
  puzzles: {
    path: "/puzzles",
    title: { zh: "象棋题目", en: "Xiangqi puzzles" },
    description: { zh: "经引擎验证的象棋战术题，按你的水平出题。", en: "Engine-checked Xiangqi tactics puzzles, matched to your level." },
  },
  bots: {
    path: "/bots",
    title: { zh: "人机对弈", en: "Play Xiangqi against bots" },
    description: { zh: "和8个不同水平、不同棋风的机器人下象棋。", en: "Play Xiangqi against 8 bots with different strengths and styles." },
  },
  analysis: {
    path: "/analysis",
    title: { zh: "象棋分析棋盘", en: "Xiangqi analysis board" },
    description: { zh: "用引擎分析局面：变化树、摆棋、FEN/PGN 导入导出。", en: "Analyse positions with an engine: variations, position set-up, FEN/PGN import and export." },
  },
  play: {
    path: "/play",
    title: { zh: "双人对弈", en: "Two-player Xiangqi board" },
    description: { zh: "两人在同一屏幕上下象棋。", en: "Play Xiangqi with a friend on one screen." },
  },
  settings: {
    path: "/settings",
    title: { zh: "设置", en: "Settings" },
    description: { zh: "语言、记谱、棋子和棋盘设置。", en: "Language, notation, piece and board settings." },
  },
};

export const pathOf = (key: PageKey) => PAGES[key].path;

/** Absolute URL of a page in a locale (static export uses trailing slashes). */
export const urlOf = (locale: Locale, path: string) => `${SITE_URL}/${locale}${path === "/" ? "" : path}/`;

export function pageMetadata(key: PageKey, locale: Locale, overrides?: { title?: string; description?: string; path?: string }): Metadata {
  const page = PAGES[key];
  const path = overrides?.path ?? page.path;
  const title = overrides?.title ?? page.title[locale];
  const description = overrides?.description ?? page.description[locale];
  return {
    title,
    description,
    alternates: {
      canonical: urlOf(locale, path),
      languages: { "zh-CN": urlOf("zh", path), en: urlOf("en", path), "x-default": urlOf("zh", path) },
    },
    openGraph: { title, description, url: urlOf(locale, path), siteName: SITE_NAME[locale], locale: locale === "zh" ? "zh_CN" : "en_US", type: "website" },
  };
}
