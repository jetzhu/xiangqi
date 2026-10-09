import type { Metadata } from "next";
import { ProfileApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // Personal data, shown only in the visitor's own browser: keep it out of search results.
  return { ...pageMetadata("profile", (await params).locale as Locale), robots: { index: false, follow: true } };
}

export default function Page() {
  return <ProfileApp />;
}
