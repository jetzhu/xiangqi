"use client";
// The guardian's page (M23), opened from the confirmation email: no account needed, the link in
// the email is the key. The guardian confirms or declines their child's request for a coach,
// may let the child link coaches without asking each time (13 to 15), and can end the link.
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type GuardianView, guardianAnswer, guardianEnd, guardianView } from "./api.js";
import { useHintText } from "./CoachPage.js";

export function GuardianPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useHintText();
  const token = nav.params().get("t") ?? "";
  const [v, setV] = useState<GuardianView | null | undefined>(undefined);
  const [lower, setLower] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    if (account.state.status === "loading" || account.state.status === "off") return;
    void account
      .client()
      .then((sb) => guardianView(sb, token))
      .then(
        (x) => {
          setV(x);
          if (x) setLower(x.line_lowered);
        },
        () => setV(null),
      );
  }, [account, token]);
  useEffect(load, [load]);

  const act = async (f: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await f();
      setMessage(done);
      load();
    } catch (e) {
      setMessage(hintText(e));
    }
  };
  const sb = () => account.client();

  if (v === undefined) return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (v === null) {
    return (
      <div className="help guardian-page">
        <h1>{tt("Coach confirmation", "教练确认")}</h1>
        <p>{tt("This link has expired or isn't valid. Your child can send a new request from their Coaching page.", "此链接已过期或无效。孩子可以在其“教练”页面重新发送请求。")}</p>
      </div>
    );
  }
  const who = v.kind === "family" ? tt("as their parent or guardian", "（作为家长或监护人）") : "";
  return (
    <div className="help guardian-page">
      <h1>{tt("Coach confirmation", "教练确认")}</h1>
      <p>
        {tt(`${v.student} asked ${v.coach} to be their coach ${who}.`, `${v.student} 请 ${v.coach} 担任教练${who}。`)}{" "}
        {tt(
          `A coach can see ${v.student}'s finished online games, their reviews and ratings: not chat, not games in progress, nothing else. There are no messages between them on the site.`,
          `教练可以看到 ${v.student} 已结束的在线对局、复盘和等级分：看不到聊天、进行中的对局或其他内容。网站上双方之间没有私信。`,
        )}
      </p>
      <p className="muted small">
        {tt(`Games this coach has opened so far: ${v.visits}.`, `该教练至今查看的对局数：${v.visits}。`)}{" "}
        <a href={nav.href("/privacy")}>{tt("Privacy policy", "隐私政策")}</a>
      </p>
      <label className="inline">
        <input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} />{" "}
        {tt(
          `From now on, ${v.student} may link coaches without asking me each time (they'll still be listed for them, and coaches can only see games).`,
          `今后 ${v.student} 关联教练时无需每次征求我的同意（教练仍会列在其页面上，且教练只能看到对局）。`,
        )}
      </label>
      {v.status === "guardian" ? (
        <p className="guardian-actions">
          <button type="button" className="primary" onClick={() => void act(async () => guardianAnswer(await sb(), token, true, lower), tt("Confirmed. The coach can now accept.", "已确认。教练现在可以接受请求。"))}>
            {tt("Confirm", "确认")}
          </button>{" "}
          <button type="button" onClick={() => void act(async () => guardianAnswer(await sb(), token, false, lower), tt("Declined. Nothing is shared.", "已拒绝。不会共享任何内容。"))}>
            {tt("Decline", "拒绝")}
          </button>
        </p>
      ) : (
        <>
          <p>
            <strong>
              {{
                coach: tt("Confirmed: waiting for the coach to accept.", "已确认：等待教练接受。"),
                review: tt("Confirmed: waiting for a moderator.", "已确认：等待管理员审核。"),
                active: tt("Linked.", "已关联。"),
                ended: tt("This link has ended.", "此关联已解除。"),
                declined: tt("Declined.", "已拒绝。"),
                guardian: "",
              }[v.status]}
            </strong>
          </p>
          <p className="guardian-actions">
            {lower !== v.line_lowered && (
              <button type="button" onClick={() => void act(async () => guardianAnswer(await sb(), token, true, lower), tt("Saved.", "已保存。"))}>
                {tt("Save the setting above", "保存上面的设置")}
              </button>
            )}{" "}
            {["coach", "review", "active"].includes(v.status) && (
              <button type="button" onClick={() => void act(async () => guardianEnd(await sb(), token), tt("The link has ended.", "关联已解除。"))}>
                {tt("End this link", "解除此关联")}
              </button>
            )}
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
