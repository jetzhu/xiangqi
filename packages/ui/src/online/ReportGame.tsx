"use client";
// Report the opponent of a finished online game (M19): a reason and an optional short note.
// Every report is reviewed; it starts a review, never decides one.
import { type FormEvent, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type ReportReason, reportPlayer, reportedGame } from "./api.js";

const REASONS: { id: ReportReason; en: string; zh: string }[] = [
  { id: "engine", en: "Engine or outside help", zh: "使用引擎或他人帮助" },
  { id: "stalling", en: "Stalling", zh: "故意拖延" },
  { id: "chat", en: "Abusive chat", zh: "聊天辱骂" },
  { id: "username", en: "Offensive username", zh: "用户名不当" },
  { id: "other", en: "Other", zh: "其他" },
];

/** Reports are taken for 7 days after a game. */
const REPORT_DAYS = 7;

export function ReportGame({ game, endedAt }: { game: string; endedAt: string | null | undefined }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [state, setState] = useState<"unknown" | "can" | "open" | "sent" | "done">("unknown");
  const [reason, setReason] = useState<ReportReason>("engine");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tooLate = !!endedAt && Date.now() - Date.parse(endedAt) > REPORT_DAYS * 86_400_000;

  useEffect(() => {
    if (tooLate) return;
    void account
      .client()
      .then((sb) => reportedGame(sb, game))
      .then((r) => setState(r ? "done" : "can"), () => setState("can"));
  }, [game, account, tooLate]);

  if (tooLate || state === "unknown") return null;
  if (state === "done") return <p className="muted small">{tt("You've reported this game.", "你已举报这盘对局。")}</p>;
  if (state === "sent") {
    return (
      <p role="status" className="small">
        {tt("Thank you. Every report is reviewed; you'll be told if action is taken.", "谢谢。每份举报都会被审核；如有处理，我们会通知你。")}
      </p>
    );
  }
  if (state === "can") {
    return (
      <button type="button" className="link small" onClick={() => setState("open")}>
        {tt("Report", "举报")}
      </button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await reportPlayer(await account.client(), game, reason, note);
      setState("sent");
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      setError(
        /too many/.test(m)
          ? tt("That's the most reports for today. Try again tomorrow.", "今天的举报次数已用完，请明天再试。")
          : /not allowed/.test(m)
            ? tt("Your account can't make reports.", "你的账号无法举报。")
            : /already/.test(m)
              ? tt("You've reported this game.", "你已举报这盘对局。")
              : tt("Couldn't send the report. Try again.", "举报发送失败，请重试。"),
      );
    }
  };
  return (
    <form className="report-form" onSubmit={(e) => void submit(e)}>
      <fieldset>
        <legend>{tt("Report your opponent", "举报对手")}</legend>
        {REASONS.map((r) => (
          <label key={r.id} className="check">
            <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} /> {tt(r.en, r.zh)}
          </label>
        ))}
        <label>
          {tt("Anything we should know (optional)", "补充说明（可选）")}
          <textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      <p className="buttons">
        <button type="submit" className="primary">
          {tt("Send report", "发送举报")}
        </button>{" "}
        <button type="button" onClick={() => setState("can")}>
          {tt("Cancel", "取消")}
        </button>
      </p>
      <p className="muted small">
        {tt("A report starts a review; it never decides one.", "举报只会启动审核，不会直接定案。")} <a href={nav.href("/fair-play")}>{tt("Fair play", "公平竞技")}</a>
      </p>
    </form>
  );
}
