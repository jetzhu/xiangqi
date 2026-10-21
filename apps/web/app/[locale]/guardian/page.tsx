import type { Metadata } from "next";
import { GuardianApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // Personal pages: nothing for search engines.
  return { ...pageMetadata("guardian", (await params).locale as Locale), robots: { index: false, follow: false } };
}

export default function Page() {
  return <GuardianApp />;
}
