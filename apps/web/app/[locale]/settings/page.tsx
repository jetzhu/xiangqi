import type { Metadata } from "next";
import { SettingsWithLocale as SettingsApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("settings", (await params).locale as Locale);
}

export default function Page() {
  return <SettingsApp />;
}
