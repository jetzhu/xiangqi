"use client";
// Feedback (M21): anyone, guests included, tells us what to improve. There is no email field,
// so the site never collects a child's email; a signed-in player may allow a reply to their
// account email instead. The page and the site version are attached so problems can be found.
import { type FormEvent, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type FeedbackKind, sendFeedback } from "../online/api.js";

const KINDS: { id: FeedbackKind; en: string; zh: string }[] = [
  { id: "problem", en: "Something doesn't work", zh: "功能出了问题" },
  { id: "idea", en: "An idea or a wish", zh: "建议或心愿" },
  { id: "content", en: "Lessons, puzzles or bots", zh: "课程、题目或机器人" },
  { id: "translation", en: "Wording or translation", zh: "文字或翻译" },
  { id: "other", en: "Something else", zh: "其他" },
];
const MAX = 2000;

export interface FeedbackPageProps {
  /** Build identifier, attached to the feedback. */
  version: string;
  /** Where to send feedback when the site runs without its server. */
  issuesUrl?: string;
}

export function FeedbackPage({ version, issuesUrl }: FeedbackPageProps) {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [mayReply, setMayReply] = useState(false);
  const [state, setState] = useState<"edit" | "sending" | "sent">("edit");
  const [error, setError] = useState<string | null>(null);
  // A child profile has no address of its own to reply to (M24).
  const signedIn = account.state.status === "signedIn" && !account.state.user.child;
  // Where the visitor came from, if it was a page of this site.
  const from = typeof document !== "undefined" && document.referrer.startsWith(location.origin) ? new URL(document.referrer).pathname : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      await sendFeedback(await account.client(), { kind, message, page: from, version, lang, mayReply: signedIn && mayReply });
      setState("sent");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(/limit/.test(m) ? tt("That's 5 today, thank you! Please send more tomorrow.", "今天已发送 5 条，谢谢！请明天再发。") : m);
      setState("edit");
    }
  };

  return (
    <div className="help feedback-page">
      <h1>{tt("Feedback", "意见反馈")}</h1>
      <p>
        {tt(
          "Tell us what to improve: something that doesn't work, an idea, a lesson or puzzle that's wrong, or a translation. Every message is read.",
          "告诉我们哪里可以改进：功能问题、新想法、有误的课程或题目，或翻译问题。每条反馈都会被认真阅读。",
        )}
      </p>
      {account.state.status === "off" ? (
        <p>
          {issuesUrl ? (
            <a href={issuesUrl}>{tt("Open an issue on GitHub", "在 GitHub 上提交问题")}</a>
          ) : (
            tt("Feedback isn't available on this copy of the site.", "此站点副本不支持反馈。")
          )}
        </p>
      ) : state === "sent" ? (
        <>
          <p role="status">{tt("Thank you! Your feedback has reached us.", "谢谢！我们已收到你的反馈。")}</p>
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setState("edit");
            }}
          >
            {tt("Send more", "继续反馈")}
          </button>
        </>
      ) : (
        <form className="contact-form" onSubmit={(e) => void submit(e)}>
          <fieldset className="feedback-kinds">
            <legend>{tt("What is it about?", "关于什么？")}</legend>
            {KINDS.map((k) => (
              <label key={k.id} className="inline">
                <input type="radio" name="kind" checked={kind === k.id} onChange={() => setKind(k.id)} /> {tt(k.en, k.zh)}
              </label>
            ))}
          </fieldset>
          <label>
            {tt("Your message", "你的反馈")}
            <textarea rows={7} maxLength={MAX} value={message} onChange={(e) => setMessage(e.target.value)} required />
          </label>
          <p className="muted small">
            {tt(
              `${message.length}/${MAX}. Please don't include your name, email, phone number or anything personal. The page you came from and the site version are added to help us find problems.`,
              `${message.length}/${MAX}。请不要填写姓名、邮箱、电话等个人信息。我们会附上你来自的页面和网站版本，便于查找问题。`,
            )}
          </p>
          {signedIn ? (
            <label className="inline">
              <input type="checkbox" checked={mayReply} onChange={(e) => setMayReply(e.target.checked)} />{" "}
              {tt("You may reply to my account email", "可以回复到我的账号邮箱")}
            </label>
          ) : (
            account.state.status === "guest" && (
              <p className="muted small">
                {tt("To get a reply, ", "如需回复，请先")}
                <a href={nav.href("/login")}>{tt("sign in", "登录")}</a>
                {tt(" first.", "。")}
              </p>
            )
          )}
          <button type="submit" disabled={!message.trim() || state === "sending"}>
            {tt("Send feedback", "发送反馈")}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
