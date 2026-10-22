"use client";
import { AccountProvider, AccountStoreProvider, NavProvider, SettingsProvider, SiteFooter, SiteNav, SkillQuestion, SyncNotice, prefixNav } from "@xq/ui";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { ACCOUNTS, BASE_PATH } from "../lib/site";
import { UpdateBanner } from "./UpdateBanner";

// The email-change banner (M23b) brings the account-security code: in its own chunk, after the page.
const EmailChangeBanner = dynamic(() => import("@xq/ui/account/security.js").then((m) => m.EmailChangeBanner), { ssr: false });
// While a child profile is open (M24): whose it is, and the way back for the parent.
const ChildBanner = dynamic(() => import("@xq/ui/account/children.js").then((m) => m.ChildBanner), { ssr: false });

type Section = "home" | "learn" | "puzzles" | "bots" | "online" | "analysis" | "play" | "settings" | "help" | "stats" | "account" | "privacy" | "terms";
const ACCOUNT_PAGES = ["signup", "login", "reset-password", "auth", "profile", "coach", "guardian", "email-change", "children", "child-account"];
/** The online-play pages all sit under "Play online" in the menu. */
const ONLINE_PAGES = ["online", "friend", "challenge", "game", "player", "leaderboard", "moderate"];

/** Providers and header for a locale; the language link points to the same page in the other locale. */
export function Shell({ locale, children }: { locale: "zh" | "en"; children: ReactNode }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const nav = useMemo(() => prefixNav(`${BASE_PATH}/${locale}`, BASE_PATH), [locale]);
  const rest = pathname.replace(/^\/(zh|en)/, "") || "/";
  const first = rest.split("/")[1] || "home";
  const section = (ACCOUNT_PAGES.includes(first) ? "account" : ONLINE_PAGES.includes(first) ? "online" : first) as Section;
  const other = locale === "zh" ? "en" : "zh";
  return (
    <SettingsProvider lang={locale}>
      <NavProvider nav={nav}>
        <AccountProvider config={ACCOUNTS}>
          <AccountStoreProvider>
            <SiteNav current={section} languageHref={`${BASE_PATH}/${other}${rest}`} />
            <UpdateBanner />
            <SyncNotice />
            <EmailChangeBanner />
            <ChildBanner />
            <SkillQuestion />
            {children}
            <SiteFooter />
          </AccountStoreProvider>
        </AccountProvider>
      </NavProvider>
    </SettingsProvider>
  );
}
