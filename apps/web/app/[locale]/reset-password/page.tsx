import type { Metadata } from "next";
import { ResetPasswordApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { ...pageMetadata("resetPassword", (await params).locale as Locale), robots: { index: false, follow: true } };
}

export default function Page() {
  return <ResetPasswordApp />;
}
