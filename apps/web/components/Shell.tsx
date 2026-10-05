"use client";
import { NavProvider, SettingsProvider, SiteNav, prefixNav } from "@xq/ui";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";

type Section = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings";

/** Providers and header for a locale; the language link points to the same page in the other locale. */
export function Shell({ locale, children }: { locale: "zh" | "en"; children: ReactNode }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const nav = useMemo(() => prefixNav(`/${locale}`), [locale]);
  const rest = pathname.replace(/^\/(zh|en)/, "") || "/";
  const section = (rest.split("/")[1] || "home") as Section;
  const other = locale === "zh" ? "en" : "zh";
  return (
    <SettingsProvider lang={locale}>
      <NavProvider nav={nav}>
        <SiteNav current={section} languageHref={`/${other}${rest}`} />
        {children}
      </NavProvider>
    </SettingsProvider>
  );
}
