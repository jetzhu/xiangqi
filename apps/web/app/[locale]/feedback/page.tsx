import type { Metadata } from "next";
import { FeedbackApp } from "../../../components/pages";
import { BUILD, ISSUES_URL, type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("feedback", (await params).locale as Locale);
}

export default function Page() {
  return <FeedbackApp version={BUILD} issuesUrl={ISSUES_URL} />;
}
