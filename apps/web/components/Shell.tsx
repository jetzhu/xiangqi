"use client";
import { AccountProvider, AccountStoreProvider, NavProvider, SettingsProvider, SiteNav, SkillQuestion, SyncNotice, prefixNav } from "@xq/ui";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { ACCOUNTS, BASE_PATH } from "../lib/site";
import { UpdateBanner } from "./UpdateBanner";

type Section = "home" | "learn" | "puzzles" | "bots" | "analysis" | "play" | "settings" | "help" | "stats" | "account" | "privacy" | "terms";
const ACCOUNT_PAGES = ["signup", "login", "reset-password", "auth", "profile"];

/** Providers and header for a locale; the language link points to the same page in the other locale. */
export function Shell({ locale, children }: { locale: "zh" | "en"; children: ReactNode }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const nav = useMemo(() => prefixNav(`${BASE_PATH}/${locale}`, BASE_PATH), [locale]);
  const rest = pathname.replace(/^\/(zh|en)/, "") || "/";
  const first = rest.split("/")[1] || "home";
  const section = (ACCOUNT_PAGES.includes(first) ? "account" : first) as Section;
  const other = locale === "zh" ? "en" : "zh";
  return (
    <SettingsProvider lang={locale}>
      <NavProvider nav={nav}>
        <AccountProvider config={ACCOUNTS}>
          <AccountStoreProvider>
            <SiteNav current={section} languageHref={`${BASE_PATH}/${other}${rest}`} />
            <UpdateBanner />
            <SyncNotice />
            <SkillQuestion />
            {children}
          </AccountStoreProvider>
        </AccountProvider>
      </NavProvider>
    </SettingsProvider>
  );
}
