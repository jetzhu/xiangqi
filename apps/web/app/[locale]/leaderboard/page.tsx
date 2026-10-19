import type { Metadata } from "next";
import { LeaderboardApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("leaderboard", (await params).locale as Locale);
}

export default function Page() {
  return <LeaderboardApp />;
}
