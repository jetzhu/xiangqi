import type { Metadata } from "next";
import { ModerateApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // For moderators only: nothing for search engines.
  return { ...pageMetadata("moderate", (await params).locale as Locale), robots: { index: false, follow: false } };
}

export default function Page() {
  return <ModerateApp />;
}
