import type { Metadata } from "next";
import { EmailChangeApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // Opened from emails only: nothing for search engines.
  return { ...pageMetadata("emailChange", (await params).locale as Locale), robots: { index: false, follow: false } };
}

export default function Page() {
  return <EmailChangeApp />;
}
