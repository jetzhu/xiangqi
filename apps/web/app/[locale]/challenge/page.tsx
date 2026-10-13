import type { Metadata } from "next";
import { ChallengeApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // One page for every challenge (/challenge?c=CODE), filled in the browser: nothing for search engines.
  return { ...pageMetadata("challenge", (await params).locale as Locale), robots: { index: false, follow: true } };
}

export default function Page() {
  return <ChallengeApp />;
}
