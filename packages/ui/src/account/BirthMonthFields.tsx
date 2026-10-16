"use client";
// Birth month and year, as the sign-up age check (AgeGate) and online play (M16) ask for them.
import { useMemo } from "react";
import { useT } from "../settings.js";

export function BirthMonthFields({ year, month, onYear, onMonth }: { year: string; month: string; onYear: (y: string) => void; onMonth: (m: string) => void }) {
  const { tt, lang } = useT();
  const locale = lang === "zh" ? "zh-CN" : "en";
  const now = new Date().getFullYear();
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale, { month: "long" })), [locale]);
  return (
    <>
      <select aria-label={tt("Month", "月")} value={month} onChange={(e) => onMonth(e.target.value)} required>
        <option value="">{tt("Month", "月")}</option>
        {months.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select aria-label={tt("Year", "年")} value={year} onChange={(e) => onYear(e.target.value)} required>
        <option value="">{tt("Year", "年")}</option>
        {Array.from({ length: 100 }, (_, i) => now - i).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </>
  );
}
