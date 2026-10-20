"use client";
// Online games in the history pages: a paged list (Stats → Games, a player's profile) and the
// table that shows them. Finished games open at /game?id=, with their Game Review.
import { formatTimeControl } from "@xq/online";
import { useCallback, useEffect, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import type { OnlineGameRow } from "./api.js";
import { SPEED_NAME } from "./PlayerPage.js";

/** Pages of games, newest first: the first page on mount, more on demand. `null` from load: no list (a minimal profile). */
export function useGamePages(load: (before: string | null) => Promise<OnlineGameRow[] | null>, size = 20) {
  const [rows, setRows] = useState<OnlineGameRow[] | null | "hidden" | "error">(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const more = useCallback(
    async (fresh = false) => {
      setBusy(true);
      try {
        const before = fresh || !Array.isArray(rows) ? null : (rows.at(-1)?.ended_at ?? null);
        const page = await load(before);
        if (page === null) return setRows("hidden");
        setRows((r) => (fresh || !Array.isArray(r) ? page : [...r, ...page]));
        setDone(page.length < size);
      } catch {
        setRows((r) => (Array.isArray(r) ? r : "error"));
      } finally {
        setBusy(false);
      }
    },
    [load, rows, size],
  );
  useEffect(() => {
    void more(true);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, done, busy, more: () => void more() };
}

export const fmtDay = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" });

/** How an online game ended, in a few words. */
export function useReasonText() {
  const { tt } = useT();
  return (r: string | null) =>
    ({
      checkmate: tt("checkmate", "将死"),
      stalemate: tt("no legal move", "困毙"),
      resign: tt("resigned", "认输"),
      timeout: tt("on time", "超时"),
      abandoned: tt("left the game", "离开对局"),
      "claim-draw": tt("opponent left", "对方离开"),
      agreement: tt("draw agreed", "议和"),
      aborted: tt("aborted", "取消"),
      "both-away": tt("both away", "双方离开"),
      "no-result": tt("no result", "无结果"),
      "illegal-move": tt("illegal move", "违规着法"),
      repetition: tt("repetition", "重复局面"),
      "natural-limit": tt("move limit", "自然限着"),
      "perpetual-check": tt("perpetual check", "长将"),
      "perpetual-chase": tt("perpetual chase", "长捉"),
      "mutual-perpetual-check": tt("both checking", "双方长将"),
      "mutual-perpetual-chase": tt("both chasing", "双方长捉"),
    })[r ?? ""] ??
    r ??
    "";
}

/** A table of online games from one player's side. */
export function OnlineGameTable({ rows }: { rows: OnlineGameRow[] }) {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const reason = useReasonText();
  return (
    <table className="game-list">
      <thead>
        <tr>
          <th>{tt("Date", "日期")}</th>
          <th>{tt("Opponent", "对手")}</th>
          <th>{tt("Time", "用时")}</th>
          <th>{tt("Result", "结果")}</th>
          <th>{tt("Rating", "等级分")}</th>
          <th>{tt("Moves", "步数")}</th>
          <th>
            <span className="sr-only">{tt("Open", "打开")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => {
          const d = g.rated && g.rating_after !== null && g.rating_before !== null ? g.rating_after - g.rating_before : null;
          return (
            <tr key={g.id} className={`r-${g.result}`}>
              <td>{fmtDay(g.ended_at, lang)}</td>
              <td className="opponent">
                {g.opponent ? <a href={nav.href(`/player?u=${encodeURIComponent(g.opponent)}`)}>{g.opponent}</a> : <span className="muted">{tt("deleted account", "已删除的账号")}</span>}
                <span className="muted small"> · {g.color === "red" ? tt("as Red", "执红") : tt("as Black", "执黑")}</span>
              </td>
              <td>
                {formatTimeControl(g)} <span className="muted small">{t(SPEED_NAME[g.speed])}</span>
              </td>
              <td>
                <strong>{g.result === "win" ? tt("Won", "胜") : g.result === "draw" ? tt("Drawn", "和") : g.result === "loss" ? tt("Lost", "负") : "–"}</strong>{" "}
                <span className="muted small">{reason(g.reason)}</span>
              </td>
              <td>{g.rated ? d === null ? "–" : <span className={d >= 0 ? "up" : "down"}>{d >= 0 ? `+${d}` : d}</span> : <span className="muted small">{tt("casual", "休闲")}</span>}</td>
              <td>{Math.ceil(g.plies / 2)}</td>
              <td>
                <a href={nav.href(`/game?id=${g.id}`)}>{tt("Open", "打开")}</a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The paged list with its "Show more" button and empty and error states. */
export function OnlineGameList({ pages, empty }: { pages: ReturnType<typeof useGamePages>; empty: string }) {
  const { tt } = useT();
  const { rows, done, busy, more } = pages;
  if (rows === null) return <p className="muted">…</p>;
  if (rows === "error") return <p className="form-error">{tt("Couldn't load the games. Check your connection and try again.", "无法载入对局，请检查网络后重试。")}</p>;
  if (rows === "hidden") return null;
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <>
      <OnlineGameTable rows={rows} />
      {!done && (
        <p>
          <button type="button" disabled={busy} onClick={more}>
            {tt("Show more", "显示更多")}
          </button>
        </p>
      )}
    </>
  );
}
