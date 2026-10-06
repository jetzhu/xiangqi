"use client";
// Site-wide settings, kept in localStorage (per browser) and shared through React context.
// Server rendering uses the defaults; saved values are applied after mount to avoid
// hydration mismatches.

import { type PieceSet, type SoundKind, type ThemeName, playSound } from "@xq/board";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "en" | "zh";
export type NotationStyle = "chinese" | "wxf" | "iccs";

export interface Settings {
  lang: Lang;
  notation: NotationStyle;
  pieceSet: PieceSet;
  theme: ThemeName;
  coordinates: "wxf" | "iccs" | "off";
  moveMethod: "both" | "drag" | "click";
  sound: boolean;
  showLegalMoves: boolean;
  /** Rated puzzles: near the solver's rating ("auto"), or from one level. */
  puzzleDifficulty: "auto" | "beginner" | "standard" | "hard" | "extraHard";
  /** Piece movement on the board; "off" also stops the pulsing check marker. */
  animation: "slow" | "normal" | "fast" | "off";
  /** Ask before a move is played (helps against misclicks). */
  confirmMove: boolean;
  /** Keep Red at the bottom even when playing or solving as Black. */
  redAtBottom: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "zh",
  notation: "chinese",
  pieceSet: "traditional",
  theme: "wood",
  coordinates: "wxf",
  moveMethod: "both",
  sound: true,
  showLegalMoves: true,
  puzzleDifficulty: "auto",
  animation: "normal",
  confirmMove: false,
  redAtBottom: false,
};

/**
 * What a screen reader says after a move, in the player's language and notation:
 * "红方 炮二平五，将军" or "Red C2.5, check". `who` replaces the side name ("You", a bot).
 */
export function announceMove(
  rec: { color: "red" | "black"; wxf: string; iccs: string; chinese: string; check?: boolean; captured?: unknown },
  notation: NotationStyle,
  lang: Lang,
  who?: string,
): string {
  const side = who ?? (lang === "zh" ? (rec.color === "red" ? "红方" : "黑方") : rec.color === "red" ? "Red" : "Black");
  const move = notation === "chinese" ? rec.chinese : notation === "iccs" ? rec.iccs : rec.wxf;
  const extras = [rec.captured ? (lang === "zh" ? "吃子" : "capture") : "", rec.check ? (lang === "zh" ? "将军" : "check") : ""].filter(Boolean);
  return `${side}${lang === "zh" ? "：" : ": "}${move}${extras.length ? (lang === "zh" ? "，" : ", ") + extras.join(lang === "zh" ? "，" : ", ") : ""}`;
}

export const ANIMATION_MS: Record<Settings["animation"], number> = { slow: 320, normal: 180, fast: 90, off: 0 };

/** Board orientation for a player or solver of `side`, honouring "Red always at the bottom". */
export function useOrientation(side: "red" | "black"): "red" | "black" {
  return useContext(SettingsContext).settings.redAtBottom ? "red" : side;
}

const KEY = "xq:settings:v1";

/** Older saved values: difficulty used to be an offset ("standard" meant "near my rating"). */
const OLD_DIFFICULTY: Record<string, Settings["puzzleDifficulty"]> = { standard: "auto", extra: "extraHard" };

function read(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings> & { puzzleDifficulty?: string }) : {};
    if (saved.puzzleDifficulty && saved.puzzleDifficulty in OLD_DIFFICULTY) saved.puzzleDifficulty = OLD_DIFFICULTY[saved.puzzleDifficulty]!;
    return saved as Partial<Settings>;
  } catch {
    return {};
  }
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: () => {} });

/**
 * `lang`, when given, is fixed by the page (e.g. the /en or /zh route) and overrides the
 * stored preference.
 */
export function SettingsProvider({ children, lang }: { children: ReactNode; lang?: Lang }) {
  const [stored, setStored] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    const saved = read();
    const browserZh = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh");
    setStored({
      ...DEFAULT_SETTINGS,
      // First visit: follow the browser's language, and its usual notation.
      ...(saved.lang ? {} : { lang: browserZh ? "zh" : "en", notation: browserZh ? "chinese" : "wxf" }),
      ...saved,
    });
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    setStored((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage blocked: settings last for this visit only
      }
      return next;
    });
  }, []);
  const settings = useMemo(() => (lang ? { ...stored, lang } : stored), [stored, lang]);
  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

export interface Text {
  en: string;
  zh: string;
}

/** Translation helpers for the current language: tt("Hint", "提示") and t({en, zh}). */
export function useT() {
  const { lang } = useSettings().settings;
  return useMemo(
    () => ({
      lang,
      tt: (en: string, zh: string) => (lang === "zh" ? zh : en),
      t: (x: Text) => x[lang],
    }),
    [lang],
  );
}

/** Board sounds that respect the user's sound setting. */
export function useSound() {
  const { sound } = useSettings().settings;
  return useCallback((kind: SoundKind) => {
    if (sound) playSound(kind);
  }, [sound]);
}
