import type { Metadata } from "next";
import { GameApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // One page for every game (/game?id=…), filled in the browser: nothing for search engines.
  return { ...pageMetadata("game", (await params).locale as Locale), robots: { index: false, follow: true } };
}

export default function Page() {
  return <GameApp />;
}
