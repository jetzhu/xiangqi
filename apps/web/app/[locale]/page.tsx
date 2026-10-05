import type { Metadata } from "next";
import { HomeApp } from "../../components/pages";
import { type Locale, pageMetadata } from "../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("home", (await params).locale as Locale);
}

export default function Home() {
  return <HomeApp />;
}
