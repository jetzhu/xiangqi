import type { Metadata } from "next";
import { SITE_URL, withBase } from "../../lib/site";

export const metadata: Metadata = {
  title: "象棋学堂 · Xiangqi School",
  alternates: { canonical: `${SITE_URL}/zh/`, languages: { "zh-CN": `${SITE_URL}/zh/`, en: `${SITE_URL}/en/` } },
};

// Static hosting has no server redirect: pick the visitor's language in the browser,
// and offer plain links for everyone else (and for search engines).
const pick = `(function(){var l=(navigator.languages&&navigator.languages[0])||navigator.language||"";location.replace(/^zh/i.test(l)?${JSON.stringify(withBase("/zh/"))}:${JSON.stringify(withBase("/en/"))});})();`;

export default function Root() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, textAlign: "center" }}>
      <script dangerouslySetInnerHTML={{ __html: pick }} />
      <h1>象棋学堂 · Xiangqi School</h1>
      <p>
        <a href={withBase("/zh/")}>中文</a> · <a href={withBase("/en/")}>English</a>
      </p>
    </main>
  );
}
