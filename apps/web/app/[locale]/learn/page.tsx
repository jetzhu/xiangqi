import { LESSONS, LESSON_ORDER } from "@xq/content";
import type { Metadata } from "next";
import { LearnWithLinks } from "../../../components/pages";
import { type Locale, pageMetadata, withBase } from "../../../lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("learn", (await params).locale as Locale);
}

export default async function Learn({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const lessons = LESSON_ORDER.map((id) => LESSONS.find((l) => l.id === id)!);
  return (
    <>
      <LearnWithLinks locale={locale} />
      {/* The lesson list as plain links, for search engines and before the app loads. */}
      <nav className="lesson-index" aria-label={locale === "zh" ? "全部课程" : "All lessons"}>
        <ol>
          {lessons.map((l) => (
            <li key={l.id}>
              <a href={withBase(`/${locale}/learn/${l.id}/`)}>{l.title[locale]}</a> — {l.summary[locale]}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
