import type { Metadata } from "next";
import { StatsApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // Personal data, shown only in the visitor's own browser: keep it out of search results.
  return { ...pageMetadata("stats", (await params).locale as Locale), robots: { index: false, follow: true } };
}

export default function Page() {
  return <StatsApp />;
}
