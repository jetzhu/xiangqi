import "@xq/ui/styles.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Shell } from "../../components/Shell";
import { COI_SERVICE_WORKER, LOCALES, SITE_NAME, SITE_URL, isLocale, withBase } from "../../lib/site";

export const dynamicParams = false;
export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const name = isLocale(locale) ? SITE_NAME[locale] : SITE_NAME.zh;
  return { metadataBase: new URL(SITE_URL), title: { default: name, template: `%s · ${name}` } };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      {COI_SERVICE_WORKER && (
        <head>
          {/* Must run before anything else: adds COOP/COEP via a service worker, reloading once. */}
          <script src={withBase("/coi-serviceworker.js")} />
        </head>
      )}
      <body>
        <Shell locale={locale}>
          <main id="main">{children}</main>
        </Shell>
      </body>
    </html>
  );
}
