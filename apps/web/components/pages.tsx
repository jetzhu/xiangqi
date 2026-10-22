"use client";
// Interactive pages run only in the browser (engine, IndexedDB, URL state); search engines
// get each page's server-rendered text instead. Each page loads its own module, not the whole
// package, so a page's code arrives in its own chunks.
import dynamic from "next/dynamic";
import { withBase } from "../lib/site";

const loading = () => <p className="muted" style={{ padding: 24 }}>…</p>;
export const HomeApp = dynamic(() => import("@xq/ui/HomePage.js").then((m) => m.HomePage), { ssr: false, loading });
export const LearnApp = dynamic(() => import("@xq/ui/learn/LearnPage.js").then((m) => m.LearnPage), { ssr: false, loading });
export const LessonApp = dynamic(() => import("@xq/ui/learn/LessonPage.js").then((m) => m.LessonPage), { ssr: false, loading });
export const PuzzlesApp = dynamic(() => import("@xq/ui/puzzles/PuzzlesPage.js").then((m) => m.PuzzlesPage), { ssr: false, loading });
export const BotsApp = dynamic(() => import("@xq/ui/bots/BotsPage.js").then((m) => m.BotsPage), { ssr: false, loading });
export const AnalysisApp = dynamic(() => import("@xq/ui/analysis/AnalysisPage.js").then((m) => m.AnalysisPage), { ssr: false, loading });
export const PlayApp = dynamic(() => import("@xq/ui/play/PlayPage.js").then((m) => m.PlayPage), { ssr: false, loading });
export const StatsApp = dynamic(() => import("@xq/ui/stats/StatsPage.js").then((m) => m.StatsPage), { ssr: false, loading });
export const ProfileApp = dynamic(() => import("@xq/ui/account/ProfilePage.js").then((m) => m.ProfilePage), { ssr: false, loading });
export const PlayerApp = dynamic(() => import("@xq/ui/online/PlayerPage.js").then((m) => m.PlayerPage), { ssr: false, loading });
export const OnlineApp = dynamic(() => import("@xq/ui/online/OnlinePage.js").then((m) => m.OnlinePage), { ssr: false, loading });
export const FriendApp = dynamic(() => import("@xq/ui/online/FriendPage.js").then((m) => m.FriendPage), { ssr: false, loading });
export const ChallengeApp = dynamic(() => import("@xq/ui/online/ChallengePage.js").then((m) => m.ChallengePage), { ssr: false, loading });
export const GameApp = dynamic(() => import("@xq/ui/online/GamePage.js").then((m) => m.GamePage), { ssr: false, loading });
export const LeaderboardApp = dynamic(() => import("@xq/ui/online/LeaderboardPage.js").then((m) => m.LeaderboardPage), { ssr: false, loading });
export const ModerateApp = dynamic(() => import("@xq/ui/online/ModeratePage.js").then((m) => m.ModeratePage), { ssr: false, loading });
export const FeedbackApp = dynamic(() => import("@xq/ui/support/FeedbackPage.js").then((m) => m.FeedbackPage), { ssr: false, loading });
export const DonateButtons = dynamic(() => import("@xq/ui/support/DonateButtons.js").then((m) => m.DonateButtons), { ssr: false, loading });
export const CoachApp = dynamic(() => import("@xq/ui/coach/CoachPage.js").then((m) => m.CoachPage), { ssr: false, loading });
export const GuardianApp = dynamic(() => import("@xq/ui/coach/GuardianPage.js").then((m) => m.GuardianPage), { ssr: false, loading });
export const EmailChangeApp = dynamic(() => import("@xq/ui/account/security.js").then((m) => m.EmailChangePage), { ssr: false, loading });
export const HelpApp = dynamic(() => import("@xq/ui/HelpPage.js").then((m) => m.HelpPage), { ssr: false, loading });
export const SignUpApp = dynamic(() => import("@xq/ui/account/AuthPages.js").then((m) => m.SignUpPage), { ssr: false, loading });
export const LogInApp = dynamic(() => import("@xq/ui/account/AuthPages.js").then((m) => m.LogInPage), { ssr: false, loading });
export const ResetPasswordApp = dynamic(() => import("@xq/ui/account/AuthPages.js").then((m) => m.ResetPasswordPage), { ssr: false, loading });
export const AuthCallbackApp = dynamic(() => import("@xq/ui/account/AuthPages.js").then((m) => m.AuthCallbackPage), { ssr: false, loading });
export const SettingsApp = dynamic(() => import("@xq/ui/SettingsPage.js").then((m) => m.SettingsPage), { ssr: false, loading });

/** The learn path with links to each lesson's own page. */
export function LearnWithLinks({ locale }: { locale: string }) {
  return <LearnApp lessonHref={(id: string) => withBase(`/${locale}/learn/${id}/`)} />;
}

/** Settings; changing the language moves to the same page in the other locale. */
export function SettingsWithLocale() {
  return <SettingsApp onLanguage={(lang: string) => location.assign(withBase(`/${lang}/settings/`))} />;
}
