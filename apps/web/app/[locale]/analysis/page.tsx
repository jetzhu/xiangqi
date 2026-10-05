import type { Metadata } from "next";
import { AnalysisApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("analysis", (await params).locale as Locale);
}

export default function Page() {
  return <AnalysisApp />;
}
