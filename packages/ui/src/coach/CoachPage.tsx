"use client";
// Coaching (M23, docs/v0.4-design.md): "My coaches" for every signed-in player (ask a coach by
// username or code, see links and every game a coach opened, end a link, report a coach), and
// "My students" for players who can coach (requests, students and their games, one-time codes).
// A student's games open at /game?id=…&coach=1, the coach's view, which is logged.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { OnlineGameList, fmtDay, useGamePages } from "../online/history.js";
import { SPEED_NAME } from "../online/PlayerPage.js";
import {
  CoachError,
  type LinkStatus,
  type MyCoaching,
  coachAnswer,
  coachStudentGames,
  createCoachCode,
  endCoachLink,
  myCoaching,
  reportCoach,
  requestCoach,
} from "./api.js";

/** What a database hint means, for the person who caused it. */
export function useHintText() {
  const { tt } = useT();
  return (e: unknown) => {
    const hint = e instanceof CoachError ? e.hint : null;
    switch (hint) {
      case "birth-month":
        return tt("Add your birth month in Settings → Account first.", "请先在“设置 → 账号”中填写出生年月。");
      case "code":
        return tt("That code doesn't work: it may be used or more than a day old. Ask your coach for a new one.", "该代码无效：可能已使用或已超过一天。请向教练索取新代码。");
      case "coach":
        return tt("No player has that username.", "没有这个用户名的棋手。");
      case "self":
        return tt("You can't be your own coach.", "不能把自己设为教练。");
      case "coach-age":
        return tt("Coaches must be 18 or over.", "教练必须年满 18 岁。");
      case "coach-email":
        return tt("That player hasn't confirmed their email, so they can't coach yet.", "该棋手尚未验证邮箱，暂时不能担任教练。");
      case "coach-new":
        return tt("That account is less than a week old, so it can't coach yet.", "该账号注册不足一周，暂时不能担任教练。");
      case "coach-barred":
        return tt("That player can't coach on this site.", "该棋手不能在本站担任教练。");
      case "exists":
        return tt("You've already asked this coach, or they're already your coach.", "你已向这位教练发出请求，或对方已是你的教练。");
      case "requests":
        return tt("You have 5 requests waiting. Wait for answers, or withdraw one.", "你有 5 个请求在等待回复。请等待，或撤回其中一个。");
      case "family-cap":
        return tt("That parent already has 3 children linked.", "这位家长已关联 3 个孩子。");
      case "guardian-email":
        return tt("Players under 16 need a parent or guardian to confirm: enter their email.", "16 岁以下的棋手需要家长或监护人确认：请填写其邮箱。");
      case "guardian-self":
        return tt("That's your own email. Enter your parent's or guardian's.", "这是你自己的邮箱。请填写家长或监护人的邮箱。");
      case "mail-limit":
        return tt("3 emails to guardians a day at most. Try again tomorrow.", "每天最多给监护人发送 3 封邮件。请明天再试。");
      case "once":
        return tt("You've already reported this today.", "你今天已举报过。");
      default:
        return e instanceof Error ? e.message : String(e);
    }
  };
}

export function CoachPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [data, setData] = useState<MyCoaching | null | undefined>(undefined);
  const load = useCallback(() => {
    if (account.state.status !== "signedIn") return;
    void account
      .client()
      .then(myCoaching)
      .then(setData, () => setData(null));
  }, [account]);
  useEffect(load, [load]);

  if (account.state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (account.state.status !== "signedIn") {
    return (
      <div className="online-page coach-page">
        <h1>{tt("Coaching", "教练")}</h1>
        <p>
          <a href={`${nav.href("/login")}?next=${encodeURIComponent("/coach/")}`}>{tt("Log in", "登录")}</a> {tt("to link a coach, or to coach students.", "后可以关联教练或担任教练。")}
        </p>
      </div>
    );
  }
  if (data === undefined) return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (data === null) return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load coaching. Check your connection and try again.", "无法载入教练信息，请检查网络后重试。")}</p>;
  return (
    <div className="online-page coach-page">
      <h1>{tt("Coaching", "教练")}</h1>
      <p className="muted">
        {tt(
          "A coach you link can see your finished online games, their reviews and your ratings: not your chat, not games in progress. There are no messages on the site. Either of you can end the link at any time.",
          "你关联的教练可以看到你已结束的在线对局、复盘和等级分：看不到聊天和进行中的对局。网站上没有私信。任何一方都可以随时解除关联。",
        )}
      </p>
      <MyCoaches data={data} reload={load} />
      <MyStudents data={data} reload={load} />
    </div>
  );
}

function statusText(s: LinkStatus, tt: (en: string, zh: string) => string) {
  return {
    guardian: tt("waiting for your parent or guardian to confirm", "等待家长或监护人确认"),
    coach: tt("waiting for the coach to accept", "等待教练接受"),
    review: tt("waiting for a moderator (the coach has many students)", "等待管理员审核（该教练学生较多）"),
    active: tt("linked", "已关联"),
    ended: tt("ended", "已解除"),
    declined: tt("declined", "已拒绝"),
  }[s];
}

function MyCoaches({ data, reload }: { data: MyCoaching; reload: () => void }) {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useHintText();
  const [by, setBy] = useState<"username" | "code">("username");
  const [who, setWho] = useState("");
  const [family, setFamily] = useState(false);
  const [guardian, setGuardian] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reporting, setReporting] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      const r = await requestCoach(await account.client(), {
        coach: by === "username" ? who : null,
        code: by === "code" ? who : null,
        family,
        guardianEmail: data.needs_guardian ? guardian : null,
      });
      setMessage({
        ok: true,
        text:
          r.status === "guardian"
            ? tt(`Sent. We've emailed your parent or guardian; ${r.coach} sees your request once they confirm.`, `已发送。我们已给你的家长或监护人发邮件；对方确认后 ${r.coach} 才会看到你的请求。`)
            : tt(`Sent. ${r.coach} will see your request on their coaching page.`, `已发送。${r.coach} 会在其教练页面看到你的请求。`),
      });
      setWho("");
      setGuardian("");
      setFamily(false);
      reload();
    } catch (err) {
      setMessage({ ok: false, text: hintText(err) });
    }
  };
  const end = async (id: number) => {
    await endCoachLink(await account.client(), id).catch(() => {});
    reload();
  };
  const report = async (e: FormEvent, id: number) => {
    e.preventDefault();
    try {
      await reportCoach(await account.client(), id, note);
      setReporting(null);
      setNote("");
      setMessage({ ok: true, text: tt("Thank you. A moderator will look at it.", "谢谢。管理员会处理。") });
    } catch (err) {
      setMessage({ ok: false, text: hintText(err) });
    }
  };
  const open = data.as_student.filter((l) => ["guardian", "coach", "review", "active"].includes(l.status));
  const past = data.as_student.filter((l) => !open.includes(l));

  return (
    <section aria-labelledby="h-my-coaches">
      <h2 id="h-my-coaches">{tt("My coaches", "我的教练")}</h2>
      {open.length === 0 ? (
        <p className="muted">{tt("No coach linked.", "尚未关联教练。")}</p>
      ) : (
        <ul className="coach-links">
          {open.map((l) => (
            <li key={l.id}>
              <a href={nav.href(`/player?u=${encodeURIComponent(l.coach)}`)}>{l.coach}</a>
              {l.kind === "family" && <span className="muted small"> · {tt("parent or guardian", "家长或监护人")}</span>} · {statusText(l.status, tt)}{" "}
              <button type="button" className="link" onClick={() => void end(l.id)}>
                {l.status === "active" ? tt("End link", "解除关联") : tt("Withdraw", "撤回")}
              </button>{" "}
              {l.status === "active" && (
                <button type="button" className="link small" onClick={() => setReporting(reporting === l.id ? null : l.id)}>
                  {tt("Report this coach", "举报此教练")}
                </button>
              )}
              {reporting === l.id && (
                <form className="contact-form" onSubmit={(e) => void report(e, l.id)}>
                  <label>
                    {tt("What happened? (a moderator reads it)", "发生了什么？（管理员会阅读）")}
                    <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
                  </label>
                  <button type="submit" disabled={!note.trim()}>
                    {tt("Send report", "发送举报")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>{tt("Ask a coach", "请求教练")}</h3>
      <form className="contact-form" onSubmit={(e) => void ask(e)}>
        <div className="segmented" role="group" aria-label={tt("Find the coach by", "查找方式")}>
          <button type="button" aria-pressed={by === "username"} onClick={() => setBy("username")}>
            {tt("Username", "用户名")}
          </button>
          <button type="button" aria-pressed={by === "code"} onClick={() => setBy("code")}>
            {tt("Code from the coach", "教练给的代码")}
          </button>
        </div>
        <label>
          {by === "username" ? tt("Coach's username", "教练的用户名") : tt("Code", "代码")}
          <input value={who} onChange={(e) => setWho(e.target.value)} required autoCapitalize={by === "code" ? "characters" : "none"} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} /> {tt("This is my parent or guardian", "这是我的家长或监护人")}
        </label>
        {data.needs_guardian && (
          <label>
            {tt("Your parent's or guardian's email (they confirm first)", "家长或监护人的邮箱（需对方先确认）")}
            <input type="email" value={guardian} onChange={(e) => setGuardian(e.target.value)} required />
          </label>
        )}
        <button type="submit" disabled={!who.trim()}>
          {tt("Send request", "发送请求")}
        </button>
      </form>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "" : "form-error"}>
          {message.text}
        </p>
      )}

      <h3>{tt("What your coaches opened", "教练查看记录")}</h3>
      {data.visits.length === 0 ? (
        <p className="muted">{tt("Nothing yet.", "暂无。")}</p>
      ) : (
        <ul className="coach-visits small">
          {data.visits.map((v, i) => (
            <li key={i}>
              {new Date(v.at).toLocaleString()} · {v.coach} {tt("opened", "查看了")}{" "}
              {v.game ? <a href={nav.href(`/game?id=${v.game}`)}>{tt("a game", "一盘对局")}</a> : tt("a game", "一盘对局")}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details>
          <summary>{tt("Past links", "过去的关联")}</summary>
          <ul className="small">
            {past.map((l) => (
              <li key={l.id}>
                {l.coach} · {statusText(l.status, tt)} {l.ended_at && fmtDay(l.ended_at, lang)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function MyStudents({ data, reload }: { data: MyCoaching; reload: () => void }) {
  const { tt, t, lang } = useT();
  const account = useAccount();
  const hintText = useHintText();
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isCoach = data.coach_problem === null || data.students.length > 0 || data.requests.length > 0;
  if (!isCoach) {
    return (
      <section aria-labelledby="h-students">
        <h2 id="h-students">{tt("Coaching others", "担任教练")}</h2>
        <p className="muted">
          {data.coach_problem === "age"
            ? tt("Coaches must be 18 or over.", "教练必须年满 18 岁。")
            : data.coach_problem === "email"
              ? tt("Confirm your email to coach.", "验证邮箱后即可担任教练。")
              : data.coach_problem === "new"
                ? tt("Accounts can coach once they're a week old.", "账号注册满一周后即可担任教练。")
                : tt("This account can't coach on this site.", "此账号不能在本站担任教练。")}
        </p>
      </section>
    );
  }
  const act = async (f: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await f();
      reload();
    } catch (e) {
      setMessage(hintText(e));
    }
  };
  const sb = () => account.client();
  return (
    <section aria-labelledby="h-students">
      <h2 id="h-students">{tt("My students", "我的学生")}</h2>
      {data.requests.length > 0 && (
        <>
          <h3>{tt("Requests", "请求")}</h3>
          <ul className="coach-links">
            {data.requests.map((r) => (
              <li key={r.id}>
                <strong>{r.student}</strong>
                {r.kind === "family" && <span className="muted small"> · {tt("says you're their parent or guardian", "称你是其家长或监护人")}</span>}
                {r.under16 && <span className="muted small"> · {tt("under 16, guardian confirmed", "16 岁以下，监护人已确认")}</span>}{" "}
                {r.status === "review" ? (
                  <span className="muted small">{tt("waiting for a moderator (over 15 students under 16)", "等待管理员审核（16 岁以下学生超过 15 名）")}</span>
                ) : (
                  <>
                    <button type="button" onClick={() => void act(async () => coachAnswer(await sb(), r.id, true))}>
                      {tt("Accept", "接受")}
                    </button>{" "}
                    <button type="button" onClick={() => void act(async () => coachAnswer(await sb(), r.id, false))}>
                      {tt("Decline", "拒绝")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.students.length === 0 ? (
        <p className="muted">{tt("No students yet. Students ask you by your username, or with a code you give them.", "暂无学生。学生可以通过你的用户名或你提供的代码向你发送请求。")}</p>
      ) : (
        <table className="game-list coach-students">
          <thead>
            <tr>
              <th>{tt("Student", "学生")}</th>
              <th>{tt("Ratings", "等级分")}</th>
              <th>{tt("Games, 30 days", "近 30 天对局")}</th>
              <th>{tt("Since", "关联于")}</th>
              <th>
                <span className="sr-only">{tt("Actions", "操作")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.student}
                  {s.kind === "family" && <span className="muted small"> · {tt("family", "家人")}</span>}
                </td>
                <td className="small">
                  {Object.entries(s.ratings)
                    .map(([k, v]) => `${t(SPEED_NAME[k as keyof typeof SPEED_NAME])} ${v}`)
                    .join(" · ") || "–"}
                </td>
                <td>{s.games_30d}</td>
                <td>{s.since ? fmtDay(s.since, lang) : "–"}</td>
                <td>
                  <button type="button" className="link" aria-expanded={open === s.student} onClick={() => setOpen(open === s.student ? null : s.student)}>
                    {tt("Games", "对局")}
                  </button>{" "}
                  <button type="button" className="link" onClick={() => void act(async () => endCoachLink(await sb(), s.id))}>
                    {tt("End link", "解除关联")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <StudentGames student={open} />}

      <h3>{tt("Codes", "代码")}</h3>
      <p className="muted small">{tt("Give a student a code to ask you with; each works once, for a day.", "把代码交给学生，学生可用其向你发送请求；每个代码只能用一次，一天内有效。")}</p>
      {data.codes.length > 0 && (
        <ul>
          {data.codes.map((c) => (
            <li key={c.code}>
              <code className="coach-code">{c.code}</code> <span className="muted small">{tt("until", "有效至")} {new Date(c.expires_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={data.coach_problem !== null} onClick={() => void act(async () => createCoachCode(await sb()))}>
        {tt("New code", "生成代码")}
      </button>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
    </section>
  );
}

function StudentGames({ student }: { student: string }) {
  const { tt } = useT();
  const account = useAccount();
  const load = useCallback(async (before: string | null) => coachStudentGames(await account.client(), student, before), [account, student]);
  const pages = useGamePages(load);
  return (
    <section aria-label={tt(`${student}'s games`, `${student} 的对局`)}>
      <h3>{tt(`${student}'s games`, `${student} 的对局`)}</h3>
      <OnlineGameList pages={pages} empty={tt("No finished online games yet.", "还没有已结束的在线对局。")} coach />
    </section>
  );
}
