"use client";
// The review page (M19, moderators only): the queue of cases, strongest evidence and highest-
// rated first, and each case with the evidence the design asks for: the player's standing
// against same-rating baselines, each checked game's accuracy, engine match, timing and focus,
// the reports with their reporters' records, sanctions and appeals, and the log. Games still
// unchecked can be analysed in the moderator's own browser, which settles them.
import { type FormEvent, type ReactNode, Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { SecondStep, assurance } from "../account/security.js";
import { type ModCoachLinks, type ModCoaching, modBarCoach, modCloseCoachReport, modCoachLinks, modCoaching, modLink } from "../coach/api.js";
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
  modSetContact,
  type AutoStep,
  type DonationLinks,
  modAutoActions,
  modLatestDigest,
  modReviewAuto,
  modSetAuto,
  modTriageSwitches,
  type TriageDigest,
  type TriageSwitch,
  type FeedbackItem,
  type FeedbackStatus,
  modFeedback,
  modFeedbackCounts,
  modSetDonations,
  modSetFeedback,
  type OperatorContact,
  siteContact,
  siteDonations,
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
  // M23b: moderator work needs a two-factor session.
  const [twoFactor, setTwoFactor] = useState<boolean | null>(null);
  const username = nav.params().get("u");
  const tab = nav.params().get("tab");

  useEffect(() => {
    if (account.state.status !== "signedIn") return setAllowed(account.state.status === "loading" ? null : false);
    void account.client().then(async (sb) => {
      setAllowed(await isModerator(sb).catch(() => false));
      setTwoFactor((await assurance(sb)).current === "aal2");
    });
  }, [account]);

  if (allowed === null) return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (!allowed) return <p style={{ padding: 24 }}>{tt("This page is for moderators.", "此页面仅供管理员使用。")}</p>;
  if (twoFactor === false) {
    return (
      <div className="online-page moderate-page">
        <h1>{tt("Confirm it's you", "确认是你本人")}</h1>
        <p className="muted">
          {tt("Moderator work needs two-factor: a passkey or an authenticator app. Without one, set it up in ", "管理员操作需要两步验证：通行密钥或身份验证器应用。如尚未设置，请在")}
          <a href={nav.href("/settings?tab=account")}>{tt("Settings → Account", "设置 → 账号")}</a>
          {tt(".", "中设置。")}
        </p>
        <SecondStep intro={null} onDone={() => setTwoFactor(true)} />
      </div>
    );
  }
  if (username) return <div className="online-page moderate-page"><Case username={username} /></div>;
  return (
    <div className="online-page moderate-page">
      <nav className="mod-tabs" aria-label={tt("Review page", "审核页面")}>
        <a href={nav.href("/moderate")} aria-current={!tab ? "page" : undefined}>
          {tt("Queue", "审核队列")}
        </a>
        <a href={nav.href("/moderate?tab=feedback")} aria-current={tab === "feedback" ? "page" : undefined}>
          {tt("Feedback", "意见反馈")}
        </a>
        <a href={nav.href("/moderate?tab=coaching")} aria-current={tab === "coaching" ? "page" : undefined}>
          {tt("Coaching", "教练")}
        </a>
        <a href={nav.href("/moderate?tab=accounts")} aria-current={tab === "accounts" ? "page" : undefined}>
          {tt("Accounts", "账号")}
        </a>
        <a href={nav.href("/moderate?tab=settings")} aria-current={tab === "settings" ? "page" : undefined}>
          {tt("Site settings", "网站设置")}
        </a>
      </nav>
      {tab === "feedback" ? (
        <FeedbackTab />
      ) : tab === "coaching" ? (
        <CoachingTab />
      ) : tab === "accounts" ? (
        <AccountsTab />
      ) : tab === "settings" ? (
        <>
          <DonationSettings />
          <ContactSettings />
        </>
      ) : (
        <Queue />
      )}
    </div>
  );
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
      <DigestPanel />
      <AutoSteps />
      <h2>{tt("Cases", "案件")}</h2>
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
          "How often each source's verdict matched your decision, including automatic steps you kept (agreed) or undid (not).",
          "各来源的初筛结论与你的处理一致的比例，包括你保留（一致）或撤销（不一致）的自动处理。",
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

      <TriageSwitches />

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

/** The operator's contact block shown in the privacy policy (a PO box keeps a home address private). */
function ContactSettings() {
  const { tt } = useT();
  const account = useAccount();
  const [c, setC] = useState<OperatorContact | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void account
      .client()
      .then(siteContact)
      .then(setC, () => {});
  }, [account]);
  if (!c) return null;
  const field = (k: keyof OperatorContact, label: string) => (
    <label>
      {label}
      <input value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: k === "phone" && !e.target.value ? null : e.target.value })} />
    </label>
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await modSetContact(await account.client(), c, note);
      setMessage(tt("Saved: the privacy policy shows it now.", "已保存：隐私政策已显示新信息。"));
      setNote("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section aria-labelledby="h-contact">
      <h2 id="h-contact">{tt("Operator contact (privacy policy)", "运营方联系方式（隐私政策）")}</h2>
      <p className="muted small">
        {tt(
          "US children's privacy rules ask for the operator's name, postal address, phone and email. A PO box and a virtual phone number keep home details private.",
          "美国儿童隐私规则要求公布运营方名称、通信地址、电话和邮箱。使用邮政信箱和虚拟电话号码可以保护住址隐私。",
        )}
      </p>
      <form className="contact-form" onSubmit={(e) => void save(e)}>
        {field("name", tt("Operator name", "运营方名称"))}
        {field("address", tt("Postal address", "通信地址"))}
        {field("phone", tt("Phone (optional)", "电话（可选）"))}
        {field("email", tt("Email", "邮箱"))}
        <label>
          {tt("Reason (kept in the log)", "理由（记入日志）")}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" disabled={!note.trim()}>
          {tt("Save contact", "保存联系方式")}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

const FEEDBACK_STATUS: { id: FeedbackStatus; en: string; zh: string }[] = [
  { id: "new", en: "New", zh: "新" },
  { id: "noted", en: "Noted", zh: "已记录" },
  { id: "planned", en: "Planned", zh: "已计划" },
  { id: "done", en: "Done", zh: "已完成" },
  { id: "wontdo", en: "Won't do", zh: "不处理" },
];
const FEEDBACK_KIND: Record<FeedbackItem["kind"], [string, string]> = {
  problem: ["Problem", "问题"],
  idea: ["Idea", "建议"],
  content: ["Lessons, puzzles, bots", "课程、题目、机器人"],
  translation: ["Wording", "文字"],
  other: ["Other", "其他"],
};

/** Feedback from the Feedback page: open items (new, noted, planned) by default, or one status. */
function FeedbackTab() {
  const { tt } = useT();
  const account = useAccount();
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<FeedbackStatus, number>>>({});
  const load = useCallback(() => {
    void account.client().then(async (sb) => {
      setItems(await modFeedback(sb, status));
      setCounts(await modFeedbackCounts(sb));
    });
  }, [account, status]);
  useEffect(load, [load]);
  const file = async (f: FeedbackItem, next: FeedbackStatus, note: string) => {
    await modSetFeedback(await account.client(), f.id, next, note || null);
    load();
  };
  return (
    <section aria-labelledby="h-feedback">
      <h1 id="h-feedback">{tt("Feedback", "意见反馈")}</h1>
      <p className="muted small">
        {tt(
          "Reply by email only where the sender allowed it (an address is shown). Done and declined items are deleted after 12 months, the rest after 24.",
          "仅在发送者允许时（显示了邮箱）通过邮件回复。已完成和不处理的反馈 12 个月后删除，其余 24 个月后删除。",
        )}
      </p>
      <div className="segmented" role="group" aria-label={tt("Show", "显示")}>
        <button type="button" aria-pressed={status === null} onClick={() => setStatus(null)}>
          {tt("Open", "未结")} ({(counts.new ?? 0) + (counts.noted ?? 0) + (counts.planned ?? 0)})
        </button>
        {FEEDBACK_STATUS.map((st) => (
          <button key={st.id} type="button" aria-pressed={status === st.id} onClick={() => setStatus(st.id)}>
            {tt(st.en, st.zh)} ({counts[st.id] ?? 0})
          </button>
        ))}
      </div>
      {items === null ? (
        <p className="muted">…</p>
      ) : items.length === 0 ? (
        <p className="muted">{tt("Nothing here.", "暂无内容。")}</p>
      ) : (
        <ul className="feedback-list">
          {items.map((f) => (
            <FeedbackRow key={f.id} f={f} onFile={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackRow({ f, onFile }: { f: FeedbackItem; onFile: (f: FeedbackItem, s: FeedbackStatus, note: string) => Promise<void> }) {
  const { tt } = useT();
  const [note, setNote] = useState(f.note ?? "");
  const [next, setNext] = useState<FeedbackStatus>(f.status);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onFile(f, next, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <li>
      <div className="small muted">
        {new Date(f.at).toLocaleString()} · <strong>{tt(...FEEDBACK_KIND[f.kind])}</strong> · {f.username ?? tt("guest", "访客")}
        {f.page && ` · ${f.page}`}
        {f.version && ` · ${f.version}`}
        {f.lang && ` · ${f.lang}`}
        {f.reply_to && (
          <>
            {" · "}
            {tt("reply to", "回复至")} <a href={`mailto:${f.reply_to}`}>{f.reply_to}</a>
          </>
        )}
      </div>
      <p className="message">{f.message}</p>
      <form className="row" onSubmit={(e) => void save(e)}>
        <label>
          {tt("Status", "状态")}{" "}
          <select value={next} onChange={(e) => setNext(e.target.value as FeedbackStatus)}>
            {FEEDBACK_STATUS.map((st) => (
              <option key={st.id} value={st.id}>
                {tt(st.en, st.zh)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {tt("Private note", "内部备注")} <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>{" "}
        <button type="submit">{tt("Save", "保存")}</button>
        {error && <span role="alert"> {error}</span>}
      </form>
    </li>
  );
}

/** The Support page's donation links (a Stripe Payment Link and GitHub Sponsors); empty hides a button. */
function DonationSettings() {
  const { tt } = useT();
  const account = useAccount();
  const [d, setD] = useState<DonationLinks | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void account
      .client()
      .then(siteDonations)
      .then((x) => setD(x ?? { stripe: null, github: null }), () => {});
  }, [account]);
  if (!d) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await modSetDonations(await account.client(), d, note);
      setMessage(tt("Saved: the Support page shows it now.", "已保存：“支持我们”页面已更新。"));
      setNote("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section aria-labelledby="h-donations">
      <h2 id="h-donations">{tt("Donation links (Support page)", "捐助链接（支持我们页面）")}</h2>
      <p className="muted small">
        {tt(
          "A Stripe Payment Link (https://buy.stripe.com/…) and a GitHub Sponsors page (https://github.com/sponsors/…). Leave one empty to hide its button.",
          "Stripe 付款链接（https://buy.stripe.com/…）和 GitHub Sponsors 页面（https://github.com/sponsors/…）。留空则隐藏对应按钮。",
        )}
      </p>
      <form className="contact-form" onSubmit={(e) => void save(e)}>
        <label>
          {tt("Stripe Payment Link", "Stripe 付款链接")}
          <input value={d.stripe ?? ""} onChange={(e) => setD({ ...d, stripe: e.target.value || null })} />
        </label>
        <label>
          {tt("GitHub Sponsors page", "GitHub Sponsors 页面")}
          <input value={d.github ?? ""} onChange={(e) => setD({ ...d, github: e.target.value || null })} />
        </label>
        <label>
          {tt("Reason (kept in the log)", "理由（记入日志）")}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" disabled={!note.trim()}>
          {tt("Save links", "保存链接")}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

const STEP_TEXT: Record<AutoStep["kind"], [string, string]> = {
  "close-report": ["Closed the report", "关闭举报"],
  "mute-chat": ["Paused chat for 7 days", "暂停聊天 7 天"],
  "hide-username": ["Hid the username", "隐藏用户名"],
};
const CATEGORY_TEXT: Record<string, [string, string]> = {
  chat: ["Chat", "聊天"],
  engine: ["Engine help", "引擎辅助"],
  other: ["Other", "其他"],
  stalling: ["Stalling", "拖延"],
  username: ["Username", "用户名"],
};

/** Whether the daily assistant has run lately: its summary is a day old at most, give or take. */
const STALE_MS = 48 * 3600_000;

/** The newest daily summary (packages/triage), as plain headings, bullets and bold text. */
function DigestPanel() {
  const { tt } = useT();
  const account = useAccount();
  const [d, setD] = useState<TriageDigest | null | undefined>(undefined);
  useEffect(() => {
    void account
      .client()
      .then(modLatestDigest)
      .then(setD, () => setD(null));
  }, [account]);
  if (d === undefined) return null;
  const stale = !d || Date.now() - Date.parse(d.at) > STALE_MS;
  return (
    <section aria-labelledby="h-digest" className="digest">
      <h2 id="h-digest">{tt("Daily summary", "每日摘要")}</h2>
      {stale && (
        <p className="form-error small">
          {d
            ? tt(`The daily assistant last ran ${new Date(d.at).toLocaleString()}. Is the PC's timer running?`, `每日助手上次运行于 ${new Date(d.at).toLocaleString()}。电脑上的定时任务是否在运行？`)
            : tt("No summary yet: the daily assistant hasn't run.", "暂无摘要：每日助手尚未运行。")}
        </p>
      )}
      {d && <Markdownish text={d.summary} />}
    </section>
  );
}

/** Just enough Markdown for the summary: ## and ### headings, "- " bullets, **bold**. Text only, no HTML. */
function Markdownish({ text }: { text: string }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith("### ")) out.push(<h4 key={out.length}>{inline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) out.push(<h3 key={out.length}>{inline(line.slice(3))}</h3>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="markdownish">{out}</div>;
}

/** Automatic steps waiting for a look (or the latest reviewed), each with Keep and Undo. */
function AutoSteps() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [pending, setPending] = useState(true);
  const [steps, setSteps] = useState<AutoStep[] | null>(null);
  const load = useCallback(() => {
    void account
      .client()
      .then((sb) => modAutoActions(sb, pending))
      .then(setSteps, () => setSteps([]));
  }, [account, pending]);
  useEffect(load, [load]);
  return (
    <section aria-labelledby="h-steps">
      <h2 id="h-steps">{tt("Automatic steps", "自动处理")}</h2>
      <p className="muted small">
        {tt(
          "Taken on their own by the rules or the AI assistant: private and reversible. Keep one to decide its report; undo it to reverse the step and reopen the report.",
          "由规则或 AI 助手自动执行：不公开、可撤销。保留即对相应举报作出决定；撤销即恢复原状并重新打开举报。",
        )}
      </p>
      <div className="segmented" role="group" aria-label={tt("Show", "显示")}>
        <button type="button" aria-pressed={pending} onClick={() => setPending(true)}>
          {tt("Waiting for a look", "待复核")}
        </button>
        <button type="button" aria-pressed={!pending} onClick={() => setPending(false)}>
          {tt("Reviewed", "已复核")}
        </button>
      </div>
      {steps === null ? (
        <p className="muted">…</p>
      ) : steps.length === 0 ? (
        <p className="muted">{pending ? tt("Nothing waiting.", "没有待复核的处理。") : tt("None yet.", "暂无。")}</p>
      ) : (
        <ul className="feedback-list auto-steps">
          {steps.map((st) => (
            <AutoStepRow key={st.id} st={st} onDone={load} nav={nav} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AutoStepRow({ st, onDone, nav }: { st: AutoStep; onDone: () => void; nav: ReturnType<typeof useNav> }) {
  const { tt } = useT();
  const account = useAccount();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const review = async (keep: boolean) => {
    setError(null);
    try {
      await modReviewAuto(await account.client(), st.id, keep, note || null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const who = st.kind === "hide-username" ? (st.details.old ?? st.target) : st.target;
  return (
    <li>
      <div className="small muted">
        {new Date(st.at).toLocaleString()} · {st.source} · {tt(...(CATEGORY_TEXT[st.category] ?? [st.category, st.category]))} · {tt("confidence", "置信度")} {Number(st.confidence).toFixed(2)}
        {st.reporter && ` · ${tt("reported by", "举报人")} ${st.reporter}`}
      </div>
      <p>
        <strong>{tt(...STEP_TEXT[st.kind])}</strong>
        {st.kind === "hide-username" && st.details.new ? ` (${tt("now", "现为")} ${st.details.new})` : ""} ·{" "}
        {st.target ? <a href={nav.href(`/moderate?u=${encodeURIComponent(st.target)}`)}>{who}</a> : who} · {st.verdict === "valid" ? tt("likely valid", "可能成立") : tt("likely invalid", "可能不成立")}
      </p>
      <p className="message">{st.reason}</p>
      {st.report_note && <p className="small">{tt("Reporter's note:", "举报说明：")} {st.report_note}</p>}
      {st.game && (
        <p className="small">
          <a href={nav.href(`/game?id=${st.game}`)}>{tt("Open the game", "打开对局")}</a>
        </p>
      )}
      {st.review ? (
        <p className="small">
          {st.review === "kept" ? tt("Kept", "已保留") : tt("Undone", "已撤销")} · {st.reviewed_by ?? "–"} · {st.reviewed_at && new Date(st.reviewed_at).toLocaleString()}
          {st.review_note && ` · ${st.review_note}`}
        </p>
      ) : (
        <div className="row">
          <label>
            {tt("Note (optional, kept in the log)", "备注（可选，记入日志）")} <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>{" "}
          <button type="button" onClick={() => void review(true)}>
            {tt("Keep", "保留")}
          </button>{" "}
          <button type="button" onClick={() => void review(false)}>
            {tt("Undo", "撤销")}
          </button>
          {error && <span role="alert"> {error}</span>}
        </div>
      )}
    </li>
  );
}

/** Each category's switch, with how its reviewed steps went. */
function TriageSwitches() {
  const { tt } = useT();
  const account = useAccount();
  const [rows, setRows] = useState<TriageSwitch[]>([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    void account
      .client()
      .then(modTriageSwitches)
      .then(setRows, () => {});
  }, [account]);
  useEffect(load, [load]);
  const flip = async (r: TriageSwitch) => {
    setMessage(null);
    try {
      await modSetAuto(await account.client(), r.category, !r.on, note);
      setNote("");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="h-switches">
      <h2 id="h-switches">{tt("Automatic steps by category", "各类别的自动处理")}</h2>
      <p className="muted small">
        {tt(
          "A category switches itself off when more than 1 in 10 of its last 20 reviewed steps were undone (and at least 2). Engine findings and 'other' reports are only ever closed automatically when unfounded.",
          "当某类别最近 20 次已复核的处理中撤销超过十分之一（且至少 2 次）时，该类别会自动关闭。引擎和“其他”类举报只会在明显不成立时被自动关闭。",
        )}
      </p>
      <label>
        {tt("Reason for switching (kept in the log)", "切换理由（记入日志）")} <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <table className="mod-table">
        <thead>
          <tr>
            <th scope="col">{tt("Category", "类别")}</th>
            <th scope="col">{tt("Automatic", "自动")}</th>
            <th scope="col">{tt("Waiting", "待复核")}</th>
            <th scope="col">{tt("Undone (last 20 reviewed)", "撤销（最近 20 次）")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category}>
              <td>{tt(...(CATEGORY_TEXT[r.category] ?? [r.category, r.category]))}</td>
              <td>{r.on ? tt("On", "开") : tt("Off", "关")}</td>
              <td>{r.pending}</td>
              <td>
                {r.undone}/{r.reviewed}
              </td>
              <td>
                <button type="button" disabled={!note.trim()} onClick={() => void flip(r)}>
                  {r.on ? tt(`Turn off ${CATEGORY_TEXT[r.category]?.[0] ?? r.category}`, `关闭${CATEGORY_TEXT[r.category]?.[1] ?? r.category}`) : tt(`Turn on ${CATEGORY_TEXT[r.category]?.[0] ?? r.category}`, `开启${CATEGORY_TEXT[r.category]?.[1] ?? r.category}`)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

/** Coach reports, links over a coach's cap, and any coach's links, with end, approve and bar. */
function CoachingTab() {
  const { tt } = useT();
  const account = useAccount();
  const [data, setData] = useState<ModCoaching | null>(null);
  const [name, setName] = useState("");
  const [coach, setCoach] = useState<ModCoachLinks | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    void account
      .client()
      .then(modCoaching)
      .then(setData, () => {});
  }, [account]);
  useEffect(load, [load]);
  const openCoach = async (u: string) => setCoach(await modCoachLinks(await account.client(), u));
  const act = async (f: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await f();
      setMessage(done);
      setNote("");
      load();
      if (coach) await openCoach(coach.coach);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const sb = () => account.client();
  const needNote = !note.trim();
  return (
    <section aria-labelledby="h-coaching">
      <h1 id="h-coaching">{tt("Coaching", "教练")}</h1>
      <label>
        {tt("Reason (kept in the log)", "理由（记入日志）")} <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {message && <p role="status">{message}</p>}
      <h2>{tt("Reports about coaches", "关于教练的举报")}</h2>
      {!data || data.reports.length === 0 ? (
        <p className="muted">{tt("None open.", "暂无未处理的举报。")}</p>
      ) : (
        <ul className="feedback-list">
          {data.reports.map((r) => (
            <li key={r.id}>
              <div className="small muted">
                {new Date(r.at).toLocaleString()} · {tt("from", "举报人")} {r.reporter ?? "–"} · {tt("link", "关联")} {r.link_status ?? "–"}
                {r.barred && ` · ${tt("barred", "已禁止")}`}
              </div>
              <p>
                <button type="button" className="link" onClick={() => void openCoach(r.coach)}>
                  {r.coach}
                </button>
              </p>
              <p className="message">{r.note}</p>
              <button type="button" disabled={needNote} onClick={() => void act(async () => modCloseCoachReport(await sb(), r.id, note), tt("Report closed.", "举报已关闭。"))}>
                {tt("Close report", "关闭举报")}
              </button>{" "}
              {r.link && r.link_status === "active" && (
                <button type="button" disabled={needNote} onClick={() => void act(async () => modLink(await sb(), r.link!, "end", note), tt("Link ended.", "关联已解除。"))}>
                  {tt("End this link", "解除此关联")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h2>{tt("Links waiting for a moderator", "等待审核的关联")}</h2>
      <p className="muted small">{tt("A coach's students under 16 past 15: check the coach before approving.", "教练的 16 岁以下学生超过 15 名：请先核查教练再批准。")}</p>
      {!data || data.review.length === 0 ? (
        <p className="muted">{tt("None.", "暂无。")}</p>
      ) : (
        <ul>
          {data.review.map((l) => (
            <li key={l.id}>
              <button type="button" className="link" onClick={() => void openCoach(l.coach)}>
                {l.coach}
              </button>{" "}
              → {l.student} ({tt(`${l.students_under16} students under 16`, `${l.students_under16} 名 16 岁以下学生`)}){" "}
              <button type="button" disabled={needNote} onClick={() => void act(async () => modLink(await sb(), l.id, "approve", note), tt("Approved.", "已批准。"))}>
                {tt("Approve", "批准")}
              </button>{" "}
              <button type="button" disabled={needNote} onClick={() => void act(async () => modLink(await sb(), l.id, "end", note), tt("Declined.", "已拒绝。"))}>
                {tt("Decline", "拒绝")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>{tt("A coach's links", "教练的关联")}</h2>
      <form
        className="find-player"
        onSubmit={(e) => {
          e.preventDefault();
          void openCoach(name.trim());
        }}
      >
        <label>
          {tt("Coach's username", "教练的用户名")} <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>{" "}
        <button type="submit">{tt("Open", "打开")}</button>
      </form>
      {coach === null && <p className="muted">{tt("No such player.", "没有这个棋手。")}</p>}
      {coach && (
        <div className="coach-case">
          <p>
            <strong>{coach.coach}</strong> · {coach.barred ? tt("barred from coaching", "已禁止担任教练") : coach.problem ? tt(`can't coach yet (${coach.problem})`, `暂不能担任教练（${coach.problem}）`) : tt("can coach", "可以担任教练")}{" "}
            <button
              type="button"
              disabled={needNote}
              onClick={() => void act(async () => modBarCoach(await sb(), coach.coach, !coach.barred, note), coach.barred ? tt("Bar lifted.", "已解除禁止。") : tt("Barred; every link ended.", "已禁止，所有关联已解除。"))}
            >
              {coach.barred ? tt("Lift the bar", "解除禁止") : tt("Bar from coaching", "禁止担任教练")}
            </button>
          </p>
          <table className="mod-table">
            <thead>
              <tr>
                <th scope="col">{tt("Student", "学生")}</th>
                <th scope="col">{tt("Kind", "类型")}</th>
                <th scope="col">{tt("State", "状态")}</th>
                <th scope="col">{tt("Games opened", "查看对局数")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {coach.links.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.student}
                    {l.under16 && <span className="muted small"> · {tt("under 16", "16 岁以下")}</span>}
                  </td>
                  <td>{l.kind}</td>
                  <td>
                    {l.status}
                    {l.ended_by && ` (${l.ended_by})`}
                  </td>
                  <td>{l.visits}</td>
                  <td>
                    {["guardian", "coach", "review", "active"].includes(l.status) && (
                      <button type="button" disabled={needNote} onClick={() => void act(async () => modLink(await sb(), l.id, "end", note), tt("Link ended.", "关联已解除。"))}>
                        {tt("End", "解除")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ModEmailChanges {
  disputed: { id: number; username: string; old: string; new: string; done_at: string }[];
  locks: { username: string; denies: number; locked_until: string | null; frozen: boolean }[];
}

/** Email changes undone from the old address ("Wasn't you?"), and locked or frozen accounts. */
function AccountsTab() {
  const { tt } = useT();
  const account = useAccount();
  const [data, setData] = useState<ModEmailChanges | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    void account.client().then(async (sb) => {
      const { data: d, error } = await sb.rpc("mod_email_changes");
      if (!error) setData(d as ModEmailChanges);
    });
  }, [account]);
  useEffect(load, [load]);
  const act = async (fn: string, args: object, done: string) => {
    setMessage(null);
    const { error } = await (await account.client()).rpc(fn, args);
    setMessage(error ? error.message : done);
    if (!error) {
      setNote("");
      load();
    }
  };
  return (
    <section aria-labelledby="h-accounts">
      <h1 id="h-accounts">{tt("Accounts", "账号")}</h1>
      <p className="muted small">
        {tt(
          "Before restoring an email or lifting a lock, ask the owner to show the account is theirs (when it was made, its games, the old address writing to us).",
          "恢复邮箱或解除锁定前，请让账号所有者证明账号属于自己（注册时间、对局记录、用旧邮箱联系我们）。",
        )}
      </p>
      <label>
        {tt("Reason (kept in the log)", "理由（记入日志）")} <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {message && <p role="status">{message}</p>}
      <h2>{tt("Disputed email changes", "有争议的邮箱更改")}</h2>
      {!data || data.disputed.length === 0 ? (
        <p className="muted">{tt("None.", "暂无。")}</p>
      ) : (
        <ul>
          {data.disputed.map((d) => (
            <li key={d.id}>
              <strong>{d.username}</strong>: {d.old} → {d.new} ({new Date(d.done_at).toLocaleString()}){" "}
              <button type="button" disabled={!note.trim()} onClick={() => void act("mod_settle_email_change", { p_change: d.id, p_restore: true, p_note: note }, tt("Old email restored.", "已恢复旧邮箱。"))}>
                {tt("Restore the old email", "恢复旧邮箱")}
              </button>{" "}
              <button type="button" disabled={!note.trim()} onClick={() => void act("mod_settle_email_change", { p_change: d.id, p_restore: false, p_note: note }, tt("Kept the new email.", "已保留新邮箱。"))}>
                {tt("Keep the new email", "保留新邮箱")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>{tt("Locked or frozen", "已锁定或冻结")}</h2>
      {!data || data.locks.length === 0 ? (
        <p className="muted">{tt("None.", "暂无。")}</p>
      ) : (
        <ul>
          {data.locks.map((l) => (
            <li key={l.username}>
              <strong>{l.username}</strong> · {l.frozen ? tt("frozen", "已冻结") : tt(`locked until ${new Date(l.locked_until!).toLocaleDateString()}`, `锁定至 ${new Date(l.locked_until!).toLocaleDateString()}`)} ·{" "}
              {tt(`${l.denies} denies`, `${l.denies} 次拒绝`)}{" "}
              <button type="button" disabled={!note.trim()} onClick={() => void act("mod_unlock_email", { p_username: l.username, p_note: note }, tt("Lifted.", "已解除。"))}>
                {tt("Lift", "解除")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
