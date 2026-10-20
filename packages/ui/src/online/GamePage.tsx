"use client";
// An online game, /game?id=… (M16). The browser plays it with the opponent's browser over a
// direct link (or the relay), runs both clocks, and reports every move to the server's queue;
// at the end the server settles and rates the game (docs/v0.3-online-design.md).
import {
  type ClaimState,
  type Dispute,
  HEARTBEAT_MS,
  OnlineGame,
  type OnlineResult,
  PHRASES,
  type Phrase,
  formatTimeControl,
  resultText,
} from "@xq/online";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Game, type MoveRecord, Position, toIccs } from "xiangqi-core";
import { Board } from "../Board.js";
import { UserAvatar } from "../account/UserAvatar.js";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { announceMove, useOrientation, useSettings, useSound, useT } from "../settings.js";
import { type GameInfo, type GamePlayer, type GameVerdict, gameInfo, settleGame } from "./api.js";
import { ReportGame } from "./ReportGame.js";

// The review loads the engine, so it comes in its own chunk once a game is over.
const GameReviewPanel = lazy(() => import("./GameReviewPanel.js"));
import { Link, type LinkState, realtimeSignaling, tabSignaling } from "./link.js";
import { LIVE_GAME_KEY } from "./live.js";
import { SPEED_NAME } from "./PlayerPage.js";
import { Reporter } from "./reporter.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GamePage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const id = nav.params().get("id") ?? "";
  const [info, setInfo] = useState<GameInfo | null | "loading" | "error">("loading");

  useEffect(() => {
    if (account.state.status === "loading") return;
    // Finished games are public (unless a player in them is under 16), so no sign-in is needed.
    if (!id) return setInfo(null);
    void account
      .client()
      .then((sb) => gameInfo(sb, id))
      .then(setInfo, () => setInfo("error"));
  }, [id, account]);

  if (info === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (info === "error") return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load the game. Check your connection and try again.", "无法载入对局，请检查网络后重试。")}</p>;
  if (!info) {
    return (
      <div className="online-page">
        <h1>{tt("Game not found", "找不到该对局")}</h1>
        <p className="muted">
          {tt(
            "A game in progress, or one with a player under 16, opens only for its two players.",
            "进行中的对局，或有 16 岁以下棋手参与的对局，只有对局双方可以打开。",
          )}
          {account.state.status !== "signedIn" && <> {tt("Log in to see your own games.", "登录后查看你自己的对局。")}</>}
        </p>
      </div>
    );
  }
  return info.status === "over" || info.me === null ? <FinishedGame info={info} /> : <LiveGame info={{ ...info, me: info.me }} />;
}

// The live game -------------------------------------------------------------------------------

function LiveGame({ info }: { info: GameInfo & { me: "red" | "black" } }) {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const { settings } = useSettings();
  const playSound = useSound();
  const orientation = useOrientation(info.me);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);
  const [linkState, setLinkState] = useState<LinkState>("connecting");
  const [chat, setChat] = useState<{ phrase: Phrase; at: number } | null>(null);
  const [verdict, setVerdict] = useState<GameVerdict | null>(null);
  const [settling, setSettling] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const ref = useRef<{ game: OnlineGame; link: Link; reporter: Reporter } | null>(null);
  const lastPlies = useRef(0);
  /** One queued move for when it's my turn (Lightning and Blitz, if premoves are on). */
  const [premove, setPremove] = useState<string | null>(null);
  const premoves = settings.premoves && info.speed !== "rapid";
  /** Whether the page lost focus during this turn: sent with the move for the fair-play record (M18). */
  const lostFocus = useRef(false);
  useEffect(() => {
    const lost = () => void (lostFocus.current = true);
    const hidden = () => document.hidden && lost();
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const settle = useCallback(async () => {
    const r = ref.current;
    if (!r) return;
    setSettling(true);
    await r.reporter.drained();
    for (let i = 0; i < 20; i++) {
      try {
        const v = await settleGame(await account.client(), info.id);
        if (v.status === "over") {
          if (v.result) r.game.adopt(v.result, Date.now());
          setVerdict(v);
          break;
        }
      } catch {
        // The server is busy or offline: the result is recorded when it's back.
      }
      await sleep(3_000);
    }
    setSettling(false);
  }, [account, info.id]);

  useEffect(() => {
    const reporter = new Reporter(account.client, info.id);
    let link: Link | null = null;
    const onDispute = (d: Dispute) => {
      // Out of step: ask the other browser for the game again; anything else goes to the server.
      if (d.kind === "out-of-step") game.hello();
      else void settle();
    };
    const game = new OnlineGame(
      { me: info.me, tc: { base: info.base, inc: info.inc }, rated: info.rated, now: Date.now() },
      {
        send: (m) => link?.send(m),
        report: (r) => reporter.report(r),
        changed: rerender,
        chat: (phrase) => setChat({ phrase, at: Date.now() }),
        dispute: onDispute,
      },
    );
    const tabTest = typeof window !== "undefined" && (window as { __xqTabSignaling?: boolean }).__xqTabSignaling;
    link = new Link({
      me: info.me,
      relay: info.relay,
      signaling: tabTest ? tabSignaling(info.id, info.me) : realtimeSignaling(account.client, info.id, info.me),
      onMessage: (m) => game.receive(m, Date.now()),
      onState: (s) => {
        setLinkState(s);
        if (s === "direct" || s === "relay") {
          game.begin(Date.now());
          game.hello();
        }
      },
      onPeerAlive: () => game.alive(Date.now()),
    });
    ref.current = { game, link, reporter };
    void link.start().catch(() => setLinkState("closed"));
    // Time passing changes the game only when something runs out (then it calls changed());
    // the clocks and countdowns redraw themselves, so the board isn't redrawn every tick.
    const tick = setInterval(() => game.tick(Date.now()), 200);
    const ping = setInterval(() => link?.state === "direct" && game.ping(Date.now()), HEARTBEAT_MS);
    const markLive = () => {
      try {
        if (game.result) localStorage.removeItem(LIVE_GAME_KEY);
        else localStorage.setItem(LIVE_GAME_KEY, JSON.stringify({ id: info.id, until: Date.now() + 30_000 }));
      } catch {
        // No storage: the analysis lock just doesn't apply.
      }
    };
    markLive();
    const live = setInterval(markLive, 10_000);
    const bye = () => game.bye();
    addEventListener("pagehide", bye);
    return () => {
      clearInterval(tick);
      clearInterval(ping);
      clearInterval(live);
      removeEventListener("pagehide", bye);
      void link?.close();
    };
    // One game, one link: set up once per game id, whatever else re-renders.
  }, [info.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = ref.current;
  const game = r?.game;
  const result = game?.result ?? null;

  // When the game ends here, have the server settle and rate it.
  useEffect(() => {
    if (result && !verdict && !settling) {
      playSound("end");
      try {
        localStorage.removeItem(LIVE_GAME_KEY);
      } catch {
        // ignore
      }
      void settle();
    }
  }, [result !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sound for each new move, then the premove if one is queued (dropped if no longer legal).
  const history: readonly MoveRecord[] = game?.game.history ?? [];
  useEffect(() => {
    if (history.length > lastPlies.current) {
      const rec = history.at(-1)!;
      playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
    }
    lastPlies.current = history.length;
    // A new turn of mine: focus counts from here.
    if (game && game.turn === info.me) lostFocus.current = !document.hasFocus();
    if (premove && game && game.turn === info.me) {
      setPremove(null);
      game.move(premove, Date.now(), lostFocus.current);
    }
  }, [history.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || !r) return <p className="muted" style={{ padding: 24 }}>…</p>;
  const me = info.me;
  const opp = me === "red" ? "black" : "red";
  const myTurn = !result && game.turn === me;
  const fen = game.game.fen;
  const last = history.at(-1);
  const checkSquare = game.game.isCheck() ? findGeneral(game.game) : null;

  const status = result
    ? t(resultText(result))
    : linkState === "connecting" && game.plies === 0
      ? tt("Connecting to your opponent…", "正在连接对手…")
      : myTurn
        ? tt("Your move", "轮到你走") + (game.game.isCheck() ? tt(" · Check!", " · 被将军！") : "")
        : tt("Opponent's move", "对方走棋");

  return (
    <div className="botgame online-game">
      <div className="board-col">
        <PlayerBar player={info[opp]} color={opp} game={game} conn={connText(linkState, game.rtt, tt)} chat={chat} />
        <Board
          fen={fen}
          orientation={orientation}
          movable={myTurn || (premoves && !result && game.plies > 0) ? me : "none"}
          legalMoves={myTurn ? game.game.legalMoves().map(toIccs) : premoves && !result ? premoveCandidates(fen) : []}
          premove={!myTurn && premoves && !result}
          onMove={(m) => {
            if (!myTurn) return setPremove(m);
            if (game.move(m, Date.now(), lostFocus.current)) setConfirmResign(false);
          }}
          lastMove={last?.iccs ?? null}
          check={checkSquare}
          arrows={premove ? [{ from: premove.slice(0, 2), to: premove.slice(2, 4), color: "blue" }] : []}
          announce={last ? announceMove(last, settings.notation, lang, last.color === me ? tt("You", "你") : (info[opp].username ?? "")) : ""}
        />
        <PlayerBar player={info[me]} color={me} game={game} conn={null} chat={null} />
      </div>

      <aside className="panel">
        <div className={`status ${result ? "over" : game.turn}`} role="status">
          <span className="dot" aria-hidden />
          {status}
        </div>
        <p className="muted small">
          {formatTimeControl(info)} · {t(SPEED_NAME[info.speed])} · {info.rated ? tt("Rated", "计分") : tt("Casual", "休闲")}
        </p>

        <Countdowns game={game} />
        {premove && !result && (
          <p className="muted small">
            {tt("Premove queued.", "已预走一步。")}{" "}
            <button type="button" className="link" onClick={() => setPremove(null)}>
              {tt("Cancel", "取消")}
            </button>
          </p>
        )}

        {game.drawOffer === opp && !result && (
          <div className="offer" role="alert">
            {tt("Your opponent offers a draw.", "对方提和。")}{" "}
            <button type="button" className="primary" onClick={() => game.acceptDraw(Date.now())}>
              {tt("Accept", "同意")}
            </button>{" "}
            <button type="button" onClick={() => game.declineDraw()}>
              {tt("Decline", "拒绝")}
            </button>
          </div>
        )}
        {game.drawOffer === me && !result && <p className="muted">{tt("Draw offered. Waiting for the answer…", "已提和，等待对方回应…")}</p>}
        {game.takeback?.by === opp && !result && (
          <div className="offer" role="alert">
            {tt("Your opponent asks to take back a move.", "对方请求悔棋。")}{" "}
            <button type="button" className="primary" onClick={() => game.acceptTakeback(Date.now())}>
              {tt("Accept", "同意")}
            </button>{" "}
            <button type="button" onClick={() => game.declineTakeback()}>
              {tt("Decline", "拒绝")}
            </button>
          </div>
        )}
        {game.takeback?.by === me && !result && <p className="muted">{tt("Takeback asked. Waiting for the answer…", "已请求悔棋，等待对方回应…")}</p>}

        {!result && (
          <div className="buttons">
            {game.canAbort() ? (
              <button type="button" onClick={() => game.abort(Date.now())}>
                {tt("Abort", "取消对局")}
              </button>
            ) : (
              <>
                <button type="button" disabled={!game.canOfferDraw()} onClick={() => game.offerDraw(Date.now())}>
                  {tt("Offer draw", "提和")}
                </button>
                {!info.rated && <TakebackButton game={game} />}
                <button
                  type="button"
                  className={confirmResign ? "primary" : ""}
                  onBlur={() => setConfirmResign(false)}
                  onClick={() => (confirmResign ? game.resign(Date.now()) : setConfirmResign(true))}
                >
                  {confirmResign ? tt("Confirm resign?", "确认认输？") : tt("Resign", "认输")}
                </button>
              </>
            )}
          </div>
        )}

        {settings.chat && (
          <div className="phrases" aria-label={tt("Chat", "快捷聊天")}>
            {(Object.keys(PHRASES) as Phrase[]).map((p) => (
              <button key={p} type="button" className="phrase" onClick={() => game.sendChat(p)}>
                {t(PHRASES[p])}
              </button>
            ))}
          </div>
        )}

        {result && <ResultPanel info={info} result={result} verdict={verdict} settling={settling} moves={game.moves} />}

        <MoveList history={history} />
        {!result && <p className="muted small">{tt("Analysis is off while you play. The clock keeps running if you leave.", "对局期间分析功能关闭。离开页面时时钟仍会继续走。")}</p>}
        {result && (
          <p>
            <a href={nav.href("/friend")}>{tt("Play a friend again", "再约好友下一局")}</a>
          </p>
        )}
      </aside>
    </div>
  );
}

/** Moves I could premove: my legal moves in this position as if it were my turn. */
function premoveCandidates(fen: string): string[] {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "b" ? "w" : "b";
  try {
    return Position.fromFen(parts.join(" ")).legalMoves().map(toIccs);
  } catch {
    return [];
  }
}

function connText(s: LinkState, rtt: number | null, tt: (en: string, zh: string) => string): string {
  if (s === "direct") return rtt === null ? tt("Connected", "已连接") : `${Math.round(rtt)} ms`;
  if (s === "relay") return tt("Relayed", "经服务器中转");
  if (s === "closed") return tt("Disconnected", "已断开");
  return tt("Connecting…", "连接中…");
}

function findGeneral(g: Game): string | null {
  const side = g.turn;
  for (let s = 0; s < 90; s++) {
    const p = g.pieceAt(s);
    if (p?.type === "k" && p.color === side) return `${"abcdefghi"[s % 9]}${Math.floor(s / 9)}`;
  }
  return null;
}

const fmtClock = (ms: number) => {
  const v = Math.max(0, ms);
  if (v < 10_000) return `0:0${(v / 1000).toFixed(1)}`;
  const s = Math.ceil(v / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The time now, redrawn every `ms` (for clocks and countdowns, so the board isn't redrawn). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function Clock({ game, color }: { game: OnlineGame | null; color: "red" | "black" }) {
  const { tt } = useT();
  const now = useNow(100);
  const ms = game ? game.clock(color, now) : 0;
  const running = !!game && !game.result && game.turn === color && game.hasMoved(color);
  return (
    <span className={`clock${running ? " running" : ""}${running && ms < 10_000 ? " low" : ""}`} role="timer" aria-label={tt("Clock", "时钟")}>
      {game ? fmtClock(ms) : "–"}
    </span>
  );
}

function PlayerBar({ player, color, game, conn, chat }: { player: GamePlayer; color: "red" | "black"; game: OnlineGame | null; conn: string | null; chat: { phrase: Phrase; at: number } | null }) {
  const { tt, t } = useT();
  const nav = useNav();
  const now = useNow(1_000);
  const name = player.username ?? tt("(deleted account)", "（已注销）");
  return (
    <div className="player-bar">
      <UserAvatar user={{ username: name, avatar: player.avatar }} size={40} />
      <div className="who">
        {player.username ? <a href={nav.href(`/player?u=${encodeURIComponent(player.username)}`)}>{name}</a> : <strong>{name}</strong>}{" "}
        {player.rating !== null && (
          <span className="bot-rating">
            {player.rating}
            {player.rd !== null && player.rd >= 110 ? "?" : ""}
          </span>
        )}{" "}
        <span className="muted small">({color === "red" ? tt("Red", "红方") : tt("Black", "黑方")})</span>
        {conn && <span className="conn muted small"> · {conn}</span>}
        {chat && now - chat.at < 6_000 && <div className="bubble">{t(PHRASES[chat.phrase])}</div>}
      </div>
      <Clock game={game} color={color} />
    </div>
  );
}

/** The first-move timer, the opponent-away banner and the lag note, redrawn as time passes. */
function Countdowns({ game }: { game: OnlineGame }) {
  const { tt } = useT();
  const now = useNow(250);
  if (game.result) return null;
  const firstLeft = game.firstMoveLeft(now);
  const claim = game.claimState(now);
  return (
    <>
      {firstLeft !== null && (
        <p className="message" role="timer">
          {game.turn === game.me
            ? tt(`Make your first move: ${Math.ceil(firstLeft / 1000)} s, or the game is aborted.`, `请走第一步：${Math.ceil(firstLeft / 1000)} 秒后对局将取消。`)
            : tt(`Waiting for the first move: ${Math.ceil(firstLeft / 1000)} s.`, `等待对方走第一步：${Math.ceil(firstLeft / 1000)} 秒。`)}
        </p>
      )}
      {game.lagAdjustedAt !== null && now - game.lagAdjustedAt < 4_000 && <p className="muted small">{tt("Opponent's clock adjusted for lag", "对方用时已按网络延迟调整")}</p>}
      {claim && <AwayBanner claim={claim} now={now} game={game} />}
    </>
  );
}

function TakebackButton({ game }: { game: OnlineGame }) {
  const { tt } = useT();
  const now = useNow(1_000);
  return (
    <button type="button" disabled={!game.canRequestTakeback(now)} onClick={() => game.requestTakeback(Date.now())}>
      {tt("Takeback", "悔棋")}
    </button>
  );
}

function AwayBanner({ claim, now, game }: { claim: ClaimState; now: number; game: OnlineGame }) {
  const { tt } = useT();
  const secs = (at: number) => Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="offer away" role="alert">
      {claim.kind === "wait" && tt(`Your opponent has left. They have ${secs(claim.at)} s to come back.`, `对方已离开，还有 ${secs(claim.at)} 秒可以返回。`)}
      {claim.kind === "early" && (
        <>
          {tt("Your opponent has been gone a minute. Claim the game, or keep waiting.", "对方已离开一分钟。你可以申请判胜，或继续等待。")}{" "}
          <button type="button" className="primary" onClick={() => game.claimWin(Date.now())}>
            {tt("Claim win", "申请判胜")}
          </button>
        </>
      )}
      {claim.kind === "last-chance" && tt(`Claimed. Your opponent has ${secs(claim.until)} s left to come back.`, `已申请判胜，对方还有 ${secs(claim.until)} 秒可以返回。`)}
      {claim.kind === "final" && (
        <>
          {tt("Your opponent didn't come back.", "对方未返回。")}{" "}
          <button type="button" className="primary" onClick={() => game.claimWin(Date.now())}>
            {tt("Claim win", "判我胜")}
          </button>{" "}
          <button type="button" onClick={() => game.claimDraw(Date.now())}>
            {tt("Claim draw", "判和棋")}
          </button>{" "}
          <span className="muted small">{tt("or keep waiting", "或继续等待")}</span>
        </>
      )}
    </div>
  );
}

function ResultPanel({ info, result, verdict, settling, moves }: { info: GameInfo; result: OnlineResult; verdict: GameVerdict | null; settling: boolean; moves: string[] }) {
  const { tt, t } = useT();
  const nav = useNav();
  const me = info.me;
  const title =
    result.winner === null
      ? result.reason === "aborted" || result.reason === "no-result"
        ? t(resultText(result))
        : tt("Draw", "和棋")
      : me === null
        ? result.winner === "red"
          ? tt(`${info.red.username ?? "Red"} won`, `${info.red.username ?? "红方"}胜`)
          : tt(`${info.black.username ?? "Black"} won`, `${info.black.username ?? "黑方"}胜`)
        : result.winner === me
          ? tt("You won!", "你赢了！")
          : tt("You lost", "你输了");
  const mine = me ? (verdict?.ratings?.[me] ?? null) : null;
  const change = (c: "red" | "black") => {
    const b = c === "red" ? info.red_rating_before : info.black_rating_before;
    const a = c === "red" ? info.red_rating_after : info.black_rating_after;
    return b !== null && a !== null ? `${info[c].username ?? c} ${b} → ${a} (${a >= b ? "+" : ""}${a - b})` : null;
  };
  return (
    <section className="gameover" aria-label="Game over">
      <h2>{title}</h2>
      <p className="muted">{t(resultText(result))}</p>
      {me === null ? (
        info.rated && change("red") ? (
          <p className="rating-line">
            {change("red")} · {change("black")}
          </p>
        ) : (
          <p className="rating-line">{info.rated ? tt("Not rated: too short, or no result.", "不计分：对局太短或无结果。") : tt("Casual game.", "休闲对局。")}</p>
        )
      ) : mine ? (
        <p className="rating-line">
          {t(SPEED_NAME[info.speed])} {mine.before} → <strong>{mine.after}</strong>{" "}
          <span className={mine.after >= mine.before ? "up" : "down"}>({mine.after >= mine.before ? `+${mine.after - mine.before}` : mine.after - mine.before})</span>
        </p>
      ) : verdict ? (
        <p className="rating-line">{info.rated ? tt("Not rated: too short, or no result.", "不计分：对局太短或无结果。") : tt("Casual game: ratings unchanged.", "休闲对局：等级分不变。")}</p>
      ) : (
        <p className="muted small">{settling ? tt("Recording the result…", "正在记录结果…") : tt("The result will be recorded when the server is reachable.", "服务器恢复后将记录结果。")}</p>
      )}
      <div className="buttons">
        <a className="button primary" href={nav.href(`/analysis${moves.length ? `?moves=${moves.join(",")}` : ""}`)}>
          {tt("Analyse", "分析棋局")}
        </a>
      </div>
      {verdict && me && <ReportGame game={info.id} endedAt={info.ended_at} />}
      {/* Once the server has the result, so a rated game's analysis can be sent for the fair-play check. */}
      {(verdict || !settling) && (
        <Suspense fallback={null}>
          <GameReviewPanel id={info.id} me={me} moves={moves} rated={!!me && !!verdict?.rated} />
        </Suspense>
      )}
    </section>
  );
}

function MoveList({ history }: { history: readonly MoveRecord[] }) {
  const { tt } = useT();
  const { settings } = useSettings();
  const rows: [MoveRecord | undefined, MoveRecord | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) rows.push([history[i], history[i + 1]]);
  const n = (r: MoveRecord) => (settings.notation === "wxf" ? r.wxf : settings.notation === "iccs" ? r.iccs : r.chinese);
  return (
    <>
      <h2>{tt("Moves", "棋谱")}</h2>
      {rows.length === 0 ? (
        <p className="muted">{tt("No moves yet.", "尚未走棋。")}</p>
      ) : (
        <ol className="moves">
          {rows.map(([a, b], i) => (
            <li key={i}>
              <span className="num">{i + 1}.</span>
              <span className="mv">{a ? n(a) : ""}</span>
              <span className="mv">{b ? n(b) : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// A finished game ----------------------------------------------------------------------------

/** A finished game, for its players or (a public game) anyone: the board, result, review and moves. */
function FinishedGame({ info }: { info: GameInfo }) {
  const { tt } = useT();
  // A viewer who didn't play sees it from Red's side.
  const side = info.me ?? "red";
  const orientation = useOrientation(side);
  const game = useMemo(() => {
    const g = new Game();
    for (const m of info.moves) g.move(m);
    return g;
  }, [info.moves]);
  const result: OnlineResult = {
    winner: info.result === "red" || info.result === "black" ? info.result : null,
    reason: (info.reason ?? "no-result") as OnlineResult["reason"],
  };
  const before = side === "red" ? info.red_rating_before : info.black_rating_before;
  const after = side === "red" ? info.red_rating_after : info.black_rating_after;
  const verdict: GameVerdict = { status: "over", result, rated: before !== null, ratings: { red: null, black: null, ...(before !== null && after !== null ? { [side]: { before, after } } : {}) } };
  const opp = side === "red" ? "black" : "red";
  return (
    <div className="botgame online-game">
      <div className="board-col">
        <PlayerBar player={info[opp]} color={opp} game={null} conn={null} chat={null} />
        <Board fen={game.fen} orientation={orientation} movable="none" lastMove={game.history.at(-1)?.iccs ?? null} />
        <PlayerBar player={info[side]} color={side} game={null} conn={null} chat={null} />
      </div>
      <aside className="panel">
        <div className="status over" role="status">
          <span className="dot" aria-hidden />
          {tt("Game over", "对局结束")}
        </div>
        <ResultPanel info={info} result={result} verdict={verdict} settling={false} moves={info.moves} />
        <MoveList history={game.history} />
      </aside>
    </div>
  );
}
