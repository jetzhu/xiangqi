"use client";
// The review page (M19, moderators only): the queue of cases, strongest evidence and highest-
// rated first, and each case with the evidence the design asks for: the player's standing
// against same-rating baselines, each checked game's accuracy, engine match, timing and focus,
// the reports with their reporters' records, sanctions and appeals, and the log. Games still
// unchecked can be analysed in the moderator's own browser, which settles them.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import {
  type ModCase,
  type QueueCase,
  isModerator,
  modAppeal,
  modBarReporter,
  modCase,
  modConfirm,
  modDismiss,
  modLogRecent,
  modQueue,
} from "./api.js";

// Analysing a game loads the engine, so it comes in its own chunk.
const ModAnalyse = lazy(() => import("./ModAnalyse.js"));

const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "–" : n.toFixed(d));

export function ModeratePage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const username = nav.params().get("u");

  useEffect(() => {
    if (account.state.status !== "signedIn") return setAllowed(account.state.status === "loading" ? null : false);
    void account
      .client()
      .then(isModerator)
      .then(setAllowed, () => setAllowed(false));
  }, [account]);

  if (allowed === null) return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (!allowed) return <p style={{ padding: 24 }}>{tt("This page is for moderators.", "此页面仅供管理员使用。")}</p>;
  return <div className="online-page moderate-page">{username ? <Case username={username} /> : <Queue />}</div>;
}

function Queue() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [cases, setCases] = useState<QueueCase[] | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof modLogRecent>>>([]);
  useEffect(() => {
    void account.client().then(async (sb) => {
      setCases(await modQueue(sb));
      setLog(await modLogRecent(sb));
    });
  }, [account]);
  return (
    <>
      <h1>{tt("Review queue", "审核队列")}</h1>
      {cases === null ? (
        <p className="muted">…</p>
      ) : cases.length === 0 ? (
        <p className="muted">{tt("Nothing to review.", "暂无待审核案件。")}</p>
      ) : (
        <table className="mod-table">
          <thead>
            <tr>
              <th scope="col">{tt("Player", "棋手")}</th>
              <th scope="col">{tt("Rating", "等级分")}</th>
              <th scope="col">{tt("Standing", "评估")}</th>
              <th scope="col">{tt("Reports (weight)", "举报（权重）")}</th>
              <th scope="col">{tt("Unchecked games", "未检查对局")}</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.username}>
                <td>
                  <a href={nav.href(`/moderate?u=${encodeURIComponent(c.username)}`)}>{c.username}</a>
                </td>
                <td>{c.rating ?? "–"}</td>
                <td>
                  {c.verdict ?? "–"} {c.score !== null && `(${fmt(c.score)})`}
                </td>
                <td>
                  {c.reports} ({fmt(c.weight)})
                </td>
                <td>{c.unchecked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>{tt("Recent actions", "最近操作")}</h2>
      <ul className="mod-log">
        {log.map((l, i) => (
          <li key={i}>
            {new Date(l.at).toLocaleString()} · {l.moderator ?? "–"} · <strong>{l.action}</strong> · {l.target ?? "–"} {l.details.note && `· ${l.details.note}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function Case({ username }: { username: string }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [c, setC] = useState<ModCase | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState<string | null>(null);

  const load = useCallback(() => {
    void account
      .client()
      .then((sb) => modCase(sb, username))
      .then(setC, () => setC(null));
  }, [account, username]);
  useEffect(load, [load]);

  const act = async (f: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await f();
      setMessage(done);
      setNote("");
      setConfirming(false);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const sb = () => account.client();

  if (c === undefined) return <p className="muted">…</p>;
  if (c === null) return <p>{tt("No such player.", "没有这名棋手。")}</p>;
  return (
    <>
      <p>
        <a href={nav.href("/moderate")}>← {tt("Review queue", "审核队列")}</a>
      </p>
      <h1>
        <a href={nav.href(`/player?u=${encodeURIComponent(c.username)}`)}>{c.username}</a>
      </h1>
      <p className="muted small">
        {tt("Joined", "注册于")} {new Date(c.created_at).toLocaleDateString()} · {tt("completion", "完成率")} {c.completion ?? "–"} % · {tt("checked games", "检查对局")}{" "}
        {c.checked_games} · {tt("as a reporter", "作为举报人")}: {c.reporter.upheld}/{c.reporter.made} {tt("upheld", "成立")}
        {c.report_barred && ` · ${tt("barred from reporting", "已禁止举报")}`}
      </p>

      <h2>{tt("Standing", "评估")}</h2>
      <table className="mod-table">
        <thead>
          <tr>
            <th scope="col">{tt("Speed", "类别")}</th>
            <th scope="col">{tt("Rating", "等级分")}</th>
            <th scope="col">{tt("Scored games", "计入对局")}</th>
            <th scope="col">{tt("Combined score", "综合分")}</th>
            <th scope="col">{tt("Games far out of line", "显著异常对局")}</th>
            <th scope="col">{tt("Verdict", "结论")}</th>
          </tr>
        </thead>
        <tbody>
          {(["lightning", "blitz", "rapid"] as const).map((s) => (
            <tr key={s}>
              <td>{s}</td>
              <td>{c.ratings[s] ? `${c.ratings[s]!.rating} ±${c.ratings[s]!.rd} (${c.ratings[s]!.games})` : "–"}</td>
              <td>{c.standing[s]?.games ?? "–"}</td>
              <td>{fmt(c.standing[s]?.score)}</td>
              <td>{c.standing[s]?.far ?? "–"}</td>
              <td>{c.standing[s]?.verdict ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{tt("Reports", "举报")}</h2>
      {c.reports.length === 0 ? (
        <p className="muted">{tt("None.", "无。")}</p>
      ) : (
        <ul className="mod-reports">
          {c.reports.map((r) => (
            <li key={r.id}>
              {new Date(r.at).toLocaleDateString()} · <strong>{r.reason}</strong> · {r.reporter} ({tt("record", "记录")} {r.record.upheld}/{r.record.made}, {tt("weight", "权重")}{" "}
              {fmt(r.record.weight)}) · {r.status}
              {r.note && <q> {r.note}</q>}
            </li>
          ))}
        </ul>
      )}

      <h2>{tt("Rated games", "计分对局")}</h2>
      <table className="mod-table">
        <thead>
          <tr>
            <th scope="col">{tt("Ended", "结束")}</th>
            <th scope="col">{tt("Game", "对局")}</th>
            <th scope="col">{tt("Check", "检查")}</th>
            <th scope="col">{tt("Accuracy", "准确度")}</th>
            <th scope="col">{tt("Engine match", "引擎吻合")}</th>
            <th scope="col">z</th>
            <th scope="col">{tt("Flags and timing", "标记与用时")}</th>
          </tr>
        </thead>
        <tbody>
          {c.games.map((g) => (
            <tr key={g.id}>
              <td>{new Date(g.ended_at).toLocaleDateString()}</td>
              <td>
                {g.speed} {g.base / 60}+{g.inc} · {g.color} {tt("vs", "对")} {g.opponent ?? "–"} · {g.result === g.color ? tt("won", "胜") : g.result === "draw" ? tt("draw", "和") : g.result === "none" ? "–" : tt("lost", "负")} ({g.reason}) ·{" "}
                {g.plies} {tt("plies", "步")} · {tt("rated", "赛前")} {g.rating_before ?? "–"}
                {g.labels.length > 0 && ` · ${g.labels.join(", ")}`}
              </td>
              <td>
                {g.status ?? tt("none", "无")}
                {g.moves && g.status !== "checked" && (
                  <>
                    {" "}
                    <button type="button" className="link" disabled={analysing !== null} onClick={() => setAnalysing(g.id)}>
                      {tt("Analyse in my browser", "在本浏览器分析")}
                    </button>
                  </>
                )}
                {analysing === g.id && g.moves && (
                  <Suspense fallback={<span className="muted"> …</span>}>
                    <ModAnalyse
                      game={g.id}
                      moves={g.moves}
                      onDone={(r) => {
                        setAnalysing(null);
                        setMessage(r);
                        load();
                      }}
                    />
                  </Suspense>
                )}
              </td>
              <td>{fmt(g.check?.acc, 1)}</td>
              <td>{g.check?.match != null ? `${Math.round(g.check.match * 100)} %` : "–"}</td>
              <td>{fmt(g.check?.z)}</td>
              <td className="small">
                {g.check?.flags.join(", ")}
                {g.check && ` cv ${fmt(g.check.timing.cv)} · fast ${fmt(g.check.timing.fast)} · focus ${fmt(g.check.timing.focus)} · hard/easy ${fmt(g.check.timing.hard_ratio)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{tt("Sanctions", "处罚")}</h2>
      {c.sanctions.length === 0 ? (
        <p className="muted">{tt("None.", "无。")}</p>
      ) : (
        <ul className="mod-sanctions">
          {c.sanctions.map((s) => (
            <li key={s.id}>
              {new Date(s.created_at).toLocaleDateString()} · {tt("level", "级别")} {s.level} · {tt("appeal", "申诉")}: {s.appeal}
              {s.overturned_at && ` · ${tt("overturned", "已撤销")}`}
              {!s.overturned_at && (
                <span className="buttons">
                  {" "}
                  {s.appeal === "none" && (
                    <button type="button" onClick={() => void act(async () => modAppeal(await sb(), s.id, "pending", note), tt("Appeal recorded.", "已记录申诉。"))}>
                      {tt("Appeal received", "收到申诉")}
                    </button>
                  )}{" "}
                  {s.appeal === "pending" && (
                    <>
                      <button type="button" onClick={() => void act(async () => modAppeal(await sb(), s.id, "upheld", note), tt("The sanction stands.", "处罚维持。"))}>
                        {tt("Reject appeal", "驳回申诉")}
                      </button>{" "}
                      <button type="button" onClick={() => void act(async () => modAppeal(await sb(), s.id, "overturned", note), tt("Sanction lifted.", "处罚已撤销。"))}>
                        {tt("Overturn", "撤销处罚")}
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>{tt("Decision", "处理")}</h2>
      <label className="mod-note">
        {tt("Reason and evidence (kept in the log)", "理由与证据（记入日志）")}
        <textarea value={note} rows={3} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="buttons">
        <button type="button" disabled={!note.trim()} onClick={() => void act(async () => modDismiss(await sb(), c.username, note), tt("Case dismissed.", "案件已驳回。"))}>
          {tt("Dismiss: no violation", "驳回：无违规")}
        </button>{" "}
        {confirming ? (
          <button
            type="button"
            className="danger"
            disabled={!note.trim()}
            onClick={() => void act(async () => modConfirm(await sb(), c.username, note), tt("Violation confirmed.", "已确认违规。"))}
          >
            {tt("Confirm violation: sanction, refunds, public mark", "确认违规：处罚、退分、公开标记")}
          </button>
        ) : (
          <button type="button" disabled={!note.trim()} onClick={() => setConfirming(true)}>
            {tt("Confirm violation…", "确认违规…")}
          </button>
        )}{" "}
        <button
          type="button"
          disabled={!note.trim()}
          onClick={() => void act(async () => modBarReporter(await sb(), c.username, !c.report_barred, note), tt("Saved.", "已保存。"))}
        >
          {c.report_barred ? tt("Allow reporting again", "恢复举报权限") : tt("Bar from reporting", "禁止举报")}
        </button>
      </p>
      {message && <p role="status">{message}</p>}

      <h2>{tt("Log", "日志")}</h2>
      <ul className="mod-log">
        {c.log.map((l, i) => (
          <li key={i}>
            {new Date(l.at).toLocaleString()} · {l.moderator ?? "–"} · <strong>{l.action}</strong> {l.details.note && `· ${l.details.note}`}
          </li>
        ))}
      </ul>
    </>
  );
}
