"use client";
// Interactive pages run only in the browser (engine, IndexedDB, URL state); search engines
// get each page's server-rendered text instead.
import dynamic from "next/dynamic";
import { withBase } from "../lib/site";

const loading = () => <p className="muted" style={{ padding: 24 }}>…</p>;
export const HomeApp = dynamic(() => import("@xq/ui").then((m) => m.HomePage), { ssr: false, loading });
export const LearnApp = dynamic(() => import("@xq/ui").then((m) => m.LearnPage), { ssr: false, loading });
export const LessonApp = dynamic(() => import("@xq/ui").then((m) => m.LessonPage), { ssr: false, loading });
export const PuzzlesApp = dynamic(() => import("@xq/ui").then((m) => m.PuzzlesPage), { ssr: false, loading });
export const BotsApp = dynamic(() => import("@xq/ui").then((m) => m.BotsPage), { ssr: false, loading });
export const AnalysisApp = dynamic(() => import("@xq/ui").then((m) => m.AnalysisPage), { ssr: false, loading });
export const PlayApp = dynamic(() => import("@xq/ui").then((m) => m.PlayPage), { ssr: false, loading });
export const StatsApp = dynamic(() => import("@xq/ui").then((m) => m.StatsPage), { ssr: false, loading });
export const ProfileApp = dynamic(() => import("@xq/ui").then((m) => m.ProfilePage), { ssr: false, loading });
export const HelpApp = dynamic(() => import("@xq/ui").then((m) => m.HelpPage), { ssr: false, loading });
export const SignUpApp = dynamic(() => import("@xq/ui").then((m) => m.SignUpPage), { ssr: false, loading });
export const LogInApp = dynamic(() => import("@xq/ui").then((m) => m.LogInPage), { ssr: false, loading });
export const ResetPasswordApp = dynamic(() => import("@xq/ui").then((m) => m.ResetPasswordPage), { ssr: false, loading });
export const AuthCallbackApp = dynamic(() => import("@xq/ui").then((m) => m.AuthCallbackPage), { ssr: false, loading });
export const SettingsApp = dynamic(() => import("@xq/ui").then((m) => m.SettingsPage), { ssr: false, loading });

/** The learn path with links to each lesson's own page. */
export function LearnWithLinks({ locale }: { locale: string }) {
  return <LearnApp lessonHref={(id: string) => withBase(`/${locale}/learn/${id}/`)} />;
}

/** Settings; changing the language moves to the same page in the other locale. */
export function SettingsWithLocale() {
  return <SettingsApp onLanguage={(lang: string) => location.assign(withBase(`/${lang}/settings/`))} />;
}
