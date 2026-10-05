import type { Metadata } from "next";
import { PuzzlesApp } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("puzzles", (await params).locale as Locale);
}

export default function Page() {
  return <PuzzlesApp />;
}
