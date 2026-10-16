"use client";
// The birth month online play needs (migration 20261012120000_birth_month.sql): asked on the Play
// online checklist, and shown and changed in Settings → Online play. Under 16 ends by itself on
// the first day of the month after the 16th birthday month.
import { type FormEvent, useState } from "react";
import { BirthMonthFields } from "../account/BirthMonthFields.js";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type Eligibility, setBirthMonth } from "./api.js";

/** "2011-06" as "June 2011" or "2011年6月". */
export function useMonthName() {
  const { lang } = useT();
  return (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long" });
}

/** Month and year selects with Save; `check` is the player's current state (null before the first answer). */
export function BirthMonthForm({ check, onSaved, label }: { check: Eligibility; onSaved: () => void; label: string }) {
  const { tt } = useT();
  const account = useAccount();
  const [y0, m0] = (check.born_next ?? check.born ?? "").split("-");
  const [year, setYear] = useState(y0 ?? "");
  const [month, setMonth] = useState(m0 ? String(Number(m0)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setBirthMonth(await account.client(), Number(year), Number(month));
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error && /already corrected/.test(err.message)
          ? tt("You've already changed it to an earlier month once. Write to us to change it again.", "你已经改过一次更早的月份。如需再次修改，请联系我们。")
          : tt("Couldn't save. Try again.", "保存失败，请重试。"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="birth-month" onSubmit={(e) => void save(e)}>
      <fieldset>
        <legend className="sr-only">{label}</legend>
        <BirthMonthFields year={year} month={month} onYear={setYear} onMonth={setMonth} />
        <button type="submit" disabled={busy || !year || !month}>
          {tt("Save", "保存")}
        </button>
      </fieldset>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

/** Settings → Online play: the birth month, when under 16 ends, a waiting change, and the form. */
export function BirthMonthSetting({ check, onSaved }: { check: Eligibility; onSaved: () => void }) {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const monthName = useMonthName();
  const day = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" });
  const withdraw = async () => {
    const [y, m] = check.born!.split("-").map(Number);
    await setBirthMonth(await account.client(), y!, m!).catch(() => {});
    onSaved();
  };
  return (
    <>
      <h2>{tt("Your birth month", "你的出生年月")}</h2>
      {check.born ? (
        <p>
          {monthName(check.born)}
          {check.under16 && check.sixteen_on && (
            <>
              {". "}
              {tt(`Under 16 until ${day(check.sixteen_on)}, when this lifts by itself.`, `${day(check.sixteen_on)}前按 16 岁以下处理，届时自动解除。`)}
            </>
          )}
        </p>
      ) : (
        <p className="muted">{tt("Not given yet. Online play needs it.", "尚未填写。在线对弈需要填写。")}</p>
      )}
      {check.born_next && check.born_next_at && (
        <p role="status">
          {tt(`Changing to ${monthName(check.born_next)} on ${day(check.born_next_at)}.`, `将于${day(check.born_next_at)}改为${monthName(check.born_next)}。`)}{" "}
          <button type="button" className="link" onClick={() => void withdraw()}>
            {tt("Keep the current month", "保留现在的月份")}
          </button>
        </p>
      )}
      <BirthMonthForm key={`${check.born}/${check.born_next}`} check={check} onSaved={onSaved} label={tt("Your birth month", "你的出生年月")} />
      <p className="muted small">
        {tt(
          "Only the month and year are kept. Players under 16 have a minimal public profile, and their games always go through our server. A later month applies at once; while you're under 16, a change to an earlier month waits a week and can be made once. ",
          "只保存年份和月份。16 岁以下的棋手公开资料从简，对局始终经服务器中转。改为更晚的月份立即生效；16 岁以下时改为更早的月份需等待一周，且只能改一次。",
        )}
        <a href={nav.href("/privacy")}>{tt("Privacy", "隐私")}</a>
      </p>
    </>
  );
}
