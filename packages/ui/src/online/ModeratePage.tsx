"use client";
// The review page (M19, moderators only): the queue of cases, strongest evidence and highest-
// rated first, and each case with the evidence the design asks for: the player's standing
// against same-rating baselines, each checked game's accuracy, engine match, timing and focus,
// the reports with their reporters' records, sanctions and appeals, and the log. Games still
// unchecked can be analysed in the moderator's own browser, which settles them.
import { type FormEvent, Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { PHRASES, type Phrase } from "@xq/online";
import { useT } from "../settings.js";
import {
  type CaseGame,
  type ModCase,
  type QueueCase,
  isModerator,
  modAppeal,
  modBarReporter,
  modCase,
  modConfirm,
  modDismiss,
  modExcuseLabel,
  modInconclusive,
  modResetSportsmanship,
  modLogRecent,
  modQueue,
  type TriageAgreement,
  type TriageVerdict,
  triageAgreement,
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
  const [agreement, setAgreement] = useState<TriageAgreement[]>([]);
  useEffect(() => {
    void account.client().then(async (sb) => {
      setCases(await modQueue(sb));
      setLog(await modLogRecent(sb));
      setAgreement(await triageAgreement(sb).catch(() => []));
    });
  }, [account]);
  return (
    <>
      <h1>{tt("Review queue", "审核队列")}</h1>
      <FindPlayer />
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
              <th scope="col">{tt("Triage (rules)", "初筛（规则）")}</th>
              <th scope="col">{tt("Last decision", "上次处理")}</th>
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
                <td className="small">
                  {c.triage && (c.triage.valid || c.triage.invalid || c.triage.inconclusive)
                    ? tt(`${c.triage.valid} likely valid · ${c.triage.invalid} likely invalid · ${c.triage.inconclusive} inconclusive`, `${c.triage.valid} 可能成立 · ${c.triage.invalid} 可能不成立 · ${c.triage.inconclusive} 不确定`)
                    : "–"}
                </td>
                <td className="small">
                  {c.last_outcome ? `${tt("Returning", "再次进入")}: ${outcomeText(c.last_outcome, tt)} ${c.last_reviewed ? new Date(c.last_reviewed).toLocaleDateString() : ""}${c.last_note ? ` · ${c.last_note}` : ""}` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>{tt("Triage agreement, last 90 days", "初筛一致率（最近 90 天）")}</h2>
      <p className="muted small">
        {tt(
          "How often each source's verdict matched your decision. Shadow mode: verdicts are shown, never acted on. A category could act on its own once its confident verdicts agree about 95 % of the time over 20 or more decisions.",
          "各来源的初筛结论与你的处理一致的比例。影子模式：只显示结论，不自动处理。当某类别的高置信度结论在 20 次以上的处理中约 95% 一致时，可考虑让其自动处理。",
        )}
      </p>
      {agreement.length === 0 ? (
        <p className="muted">{tt("No decisions yet.", "暂无处理记录。")}</p>
      ) : (
        <table className="mod-table">
          <thead>
            <tr>
              <th scope="col">{tt("Source", "来源")}</th>
              <th scope="col">{tt("Reason", "举报原因")}</th>
              <th scope="col">{tt("Agreed", "一致")}</th>
              <th scope="col">{tt("Confident (0.8+) agreed", "高置信度一致")}</th>
            </tr>
          </thead>
          <tbody>
            {agreement.map((a) => (
              <tr key={`${a.source}/${a.category}`}>
                <td>{a.source}</td>
                <td>{a.category}</td>
                <td>
                  {a.agreed}/{a.decisions} ({Math.round((100 * a.agreed) / Math.max(1, a.decisions))} %)
                </td>
                <td>{a.confident ? `${a.confident_agreed}/${a.confident} (${Math.round((100 * a.confident_agreed) / a.confident)} %)` : "–"}</td>
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

      {c.review && (
        <p className="case-review">
          {tt("Last decision", "上次处理")}: <strong>{outcomeText(c.review.outcome, tt)}</strong> · {new Date(c.review.at).toLocaleDateString()}
          {c.review.note && ` · ${c.review.note}`}
        </p>
      )}

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
              {r.triage && r.triage.length > 0 && (
                <ul className="triage">
                  {r.triage.map((t) => (
                    <TriageLine key={t.source} t={t} />
                  ))}
                </ul>
              )}
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
                {g.labels.map((l) => (
                  <span key={l} className="mod-label">
                    {" · "}
                    {l}
                    {l !== "slow-start" && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="link small"
                          disabled={!note.trim()}
                          title={note.trim() ? "" : tt("Write the reason in the note box first", "请先在下方填写理由")}
                          onClick={() => void act(async () => modExcuseLabel(await sb(), g.id, c.username, l, note), tt("Mark excused.", "已撤销该标记。"))}
                        >
                          {tt("Excuse", "撤销")}
                        </button>
                      </>
                    )}
                  </span>
                ))}
                {g.chat && <GameChat chat={g.chat} me={g.color} />}
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
          {tt("No violation", "无违规")}
        </button>{" "}
        <button
          type="button"
          disabled={!note.trim()}
          onClick={() => void act(async () => modInconclusive(await sb(), c.username, note), tt("Kept open: back in the queue with new evidence.", "保持未结：有新证据时重新进入队列。"))}
        >
          {tt("Not conclusive", "证据不足")}
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
        </button>{" "}
        <button
          type="button"
          disabled={!note.trim()}
          onClick={() => void act(async () => modResetSportsmanship(await sb(), c.username, note), tt("Sportsmanship record reset: only games from now count.", "棋品记录已重置：只计算此后的对局。"))}
        >
          {tt("Reset sportsmanship record", "重置棋品记录")}
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

function outcomeText(o: "no-violation" | "inconclusive" | "violation", tt: (en: string, zh: string) => string) {
  return o === "no-violation" ? tt("no violation", "无违规") : o === "violation" ? tt("violation", "违规") : tt("not conclusive", "证据不足");
}

/**
 * A game's chat as each browser recorded it. Both records agree unless one browser left
 * something out or added it, which is itself evidence.
 */
function GameChat({ chat, me }: { chat: NonNullable<CaseGame["chat"]>; me: "red" | "black" }) {
  const { tt, t } = useT();
  const line = (e: { ply: number; by: "red" | "black"; phrase: string }) =>
    `${e.ply}: ${e.by === me ? tt("player", "被查棋手") : tt("opponent", "对手")} “${PHRASES[e.phrase as Phrase] ? t(PHRASES[e.phrase as Phrase]) : e.phrase}”`;
  const red = chat.red ?? [];
  const black = chat.black ?? [];
  const same = JSON.stringify(red) === JSON.stringify(black);
  return (
    <details className="game-chat">
      <summary>
        {tt("Chat", "聊天")} ({Math.max(red.length, black.length)}){!same && ` · ${tt("the two records differ", "双方记录不一致")}`}
      </summary>
      {same ? (
        <ul>{red.map((e, i) => <li key={i}>{line(e)}</li>)}</ul>
      ) : (
        (["red", "black"] as const).map((c) => (
          <div key={c}>
            <strong>{c === me ? tt("Player's browser", "被查棋手的浏览器") : tt("Opponent's browser", "对手的浏览器")}</strong>
            <ul>{(chat[c] ?? []).map((e, i) => <li key={i}>{line(e)}</li>)}</ul>
          </div>
        ))
      )}
    </details>
  );
}

/** One verdict on a report: who gave it (the rules, or an adviser such as "ai:claude-code"), how sure, and why. */
function TriageLine({ t }: { t: TriageVerdict }) {
  const { tt } = useT();
  const verdict = t.verdict === "valid" ? tt("likely valid", "可能成立") : t.verdict === "invalid" ? tt("likely invalid", "可能不成立") : tt("inconclusive", "不确定");
  const who = t.source === "rules" ? tt("Rules", "规则") : t.source.replace(/^ai:/, "AI: ");
  return (
    <li className={`triage-${t.verdict}`}>
      <strong>{who}</strong>: {verdict} ({Number(t.confidence).toFixed(2)}) · <span className="muted">{t.rule}</span> · {t.reason}
    </li>
  );
}

/** Opens any player's case by username, not only those in the queue. */
function FindPlayer() {
  const { tt } = useT();
  const nav = useNav();
  const [name, setName] = useState("");
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) location.assign(nav.href(`/moderate?u=${encodeURIComponent(name.trim())}`));
  };
  return (
    <form className="find-player" onSubmit={go}>
      <label>
        {tt("Open a player's case", "查看棋手案件")} <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tt("username", "用户名")} />
      </label>{" "}
      <button type="submit">{tt("Open", "打开")}</button>
    </form>
  );
}
