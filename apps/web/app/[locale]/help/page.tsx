import type { Metadata } from "next";
import { HelpApp } from "../../../components/pages";
import { BUILD, ISSUES_URL, type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("help", (await params).locale as Locale);
}

export default function Page() {
  return <HelpApp version={BUILD} issuesUrl={ISSUES_URL} />;
}
