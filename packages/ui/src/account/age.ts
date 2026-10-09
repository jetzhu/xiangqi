// The age check before an account is made (M14): chess.com's minimum ages by country. Younger
// players stay guests (everything works, progress stays in their browser), so no child's data
// reaches the server. Nothing about the answer is stored.
export const MIN_AGE: Record<string, number> = { IT: 14, KR: 14, FR: 15, JP: 15, DE: 16, ES: 16, NL: 16, PL: 16, HK: 18, IN: 18 };
export const minAgeFor = (country: string) => MIN_AGE[country] ?? 13;

/**
 * Whether someone born in `month` (1–12) of `year` is old enough in `country`. Without the day,
 * a birthday this month counts as not yet reached.
 */
export function oldEnough(year: number, month: number, country: string, now = new Date()): boolean {
  let age = now.getFullYear() - year;
  if (month >= now.getMonth() + 1) age--;
  return age >= minAgeFor(country);
}

const KEY = "xq:age-checked";
/** Passed the check in this tab (so a Google/Microsoft/GitHub sign-up isn't asked twice). */
export function ageChecked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function markAgeChecked() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}
