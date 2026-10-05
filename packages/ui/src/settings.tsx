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
};

const KEY = "xq:settings:v1";

function read(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
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
