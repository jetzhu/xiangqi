"use client";
import { NavProvider, SettingsProvider, SiteNav, prefixNav } from "@xq/ui";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { BASE_PATH } from "../lib/site";
import { UpdateBanner } from "./UpdateBanner";

type Section = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings" | "help" | "stats";

/** Providers and header for a locale; the language link points to the same page in the other locale. */
export function Shell({ locale, children }: { locale: "zh" | "en"; children: ReactNode }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const nav = useMemo(() => prefixNav(`${BASE_PATH}/${locale}`, BASE_PATH), [locale]);
  const rest = pathname.replace(/^\/(zh|en)/, "") || "/";
  const section = (rest.split("/")[1] || "home") as Section;
  const other = locale === "zh" ? "en" : "zh";
  return (
    <SettingsProvider lang={locale}>
      <NavProvider nav={nav}>
        <SiteNav current={section} languageHref={`${BASE_PATH}/${other}${rest}`} />
        <UpdateBanner />
        {children}
      </NavProvider>
    </SettingsProvider>
  );
}
