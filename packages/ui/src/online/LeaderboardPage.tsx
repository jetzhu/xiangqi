"use client";
// Leaderboards (M19): the top 50 at each speed. To be listed a player needs 30 rated games, a
// settled rating, a game in the last 30 days and 10 fair-play checked games, and no confirmed
// violation; their games are then always checked.
import { useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type LeaderboardRow, SPEEDS, type Speed, leaderboard } from "./api.js";
import { SPEED_NAME } from "./PlayerPage.js";

export function LeaderboardPage() {
  const { tt, t } = useT();
  const nav = useNav();
  const account = useAccount();
  const [speed, setSpeed] = useState<Speed>("blitz");
  const [rows, setRows] = useState<LeaderboardRow[] | null | "error">(null);

  useEffect(() => {
    if (account.state.status === "loading") return;
    setRows(null);
    void account
      .client()
      .then((sb) => leaderboard(sb, speed))
      .then(setRows, () => setRows("error"));
  }, [speed, account]);

  return (
    <div className="online-page leaderboard-page">
      <h1>{tt("Leaderboards", "排行榜")}</h1>
      <div className="segmented" role="tablist" aria-label={tt("Speed", "用时类别")}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={speed === s} className={speed === s ? "selected" : ""} onClick={() => setSpeed(s)}>
            {t(SPEED_NAME[s])}
          </button>
        ))}
      </div>
      {rows === "error" ? (
        <p className="form-error">{tt("Couldn't load the leaderboard. Check your connection and try again.", "无法载入排行榜，请检查网络后重试。")}</p>
      ) : rows === null ? (
        <p className="muted">…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{tt("Nobody qualifies yet.", "暂时还没有棋手上榜。")}</p>
      ) : (
        <table className="leaderboard">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{tt("Player", "棋手")}</th>
              <th scope="col">{tt("Rating", "等级分")}</th>
              <th scope="col">{tt("Games", "对局")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.username}>
                <td>{r.rank}</td>
                <td>
                  <a href={nav.href(`/player?u=${encodeURIComponent(r.username)}`)}>{r.username}</a>
                </td>
                <td>{r.rating}</td>
                <td>{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        {tt(
          "To be listed: 30 rated games at that speed, a settled rating, a game in the last 30 days, 10 fair-play checked games, and no confirmed violation.",
          "上榜条件：该用时类别 30 盘计分对局、等级分已稳定、最近 30 天内下过棋、10 盘公平性检查对局，且无已确认的违规记录。",
        )}
      </p>
    </div>
  );
}
