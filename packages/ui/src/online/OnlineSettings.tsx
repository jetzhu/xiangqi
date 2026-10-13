"use client";
// Settings → Online play (M15): opponent filters, game options, network address, blocked players.
import { useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { type Settings, useSettings, useT } from "../settings.js";
import { myBlocks, setBlocked } from "./api.js";

export function OnlineSettings() {
  const { settings, update } = useSettings();
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [blocks, setBlocks] = useState<{ username: string }[] | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

  useEffect(() => {
    void account
      .client()
      .then(myBlocks)
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, [account]);

  const unblock = async (username: string) => {
    await setBlocked(await account.client(), username, false);
    setBlocks((b) => b?.filter((x) => x.username !== username) ?? null);
  };

  return (
    <div className="online-settings">
      <p className="sub">
        {tt("Opponent filters apply to quick pairing, coming with v0.3. The rest apply to your games now.", "对手筛选用于 v0.3 推出的快速匹配；其余设置现在即对你的对局生效。")}{" "}
        <a href={nav.href("/online")}>{tt("Get ready for online play", "在线对弈准备")}</a>
      </p>

      <h2>{tt("Opponents", "对手")}</h2>
      <p className="muted small">
        {tt("Filters work both ways: you're only matched with players whose filters also accept you. Narrow filters mean longer waits.", "筛选是双向的：只有双方的条件都满足才会匹配。条件越严，等待越久。")}
      </p>
      <div className="options">
        <label>
          {tt("Rating range", "等级分范围")}
          <select value={String(settings.opponentRange)} onChange={(e) => set("opponentRange", e.target.value === "any" ? "any" : (Number(e.target.value) as Settings["opponentRange"]))}>
            {[100, 200, 300, 400].map((n) => (
              <option key={n} value={n}>
                ±{n}
              </option>
            ))}
            <option value="any">{tt("Any", "不限")}</option>
          </select>
        </label>
        <label>
          {tt("Account age", "账号注册时长")}
          <select value={settings.opponentAccountAge} onChange={(e) => set("opponentAccountAge", Number(e.target.value) as Settings["opponentAccountAge"])}>
            <option value={0}>{tt("Any", "不限")}</option>
            <option value={7}>{tt("At least 7 days", "至少 7 天")}</option>
            <option value={30}>{tt("At least 30 days", "至少 30 天")}</option>
          </select>
        </label>
        <label>
          {tt("Completion rate (棋品)", "棋品（完成率）")}
          <select value={settings.opponentCompletion} onChange={(e) => set("opponentCompletion", Number(e.target.value) as Settings["opponentCompletion"])}>
            <option value={0}>{tt("Any", "不限")}</option>
            <option value={90}>{tt("90 % or more", "90% 以上")}</option>
            <option value={95}>{tt("95 % or more", "95% 以上")}</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.opponentEstablished} onChange={(e) => set("opponentEstablished", e.target.checked)} />
          {tt("Established players only (no provisional rating)", "只匹配等级分已稳定的棋手")}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.opponentChecked} onChange={(e) => set("opponentChecked", e.target.checked)} />
          {tt("Only players with 10 or more fair-play checked games", "只匹配已有 10 盘以上公平性检查的棋手")}
        </label>
      </div>

      <h2>{tt("During a game", "对局中")}</h2>
      <div className="options">
        <label className="check">
          <input type="checkbox" checked={settings.premoves} onChange={(e) => set("premoves", e.target.checked)} />
          {tt("Premoves in Lightning and Blitz", "闪电和超快棋中允许预走")}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.chat} onChange={(e) => set("chat", e.target.checked)} />
          {tt("Show the opponent's chat phrases", "显示对手的快捷聊天")}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.relayOnly} onChange={(e) => set("relayOnly", e.target.checked)} />
          {tt("Don't share my network address", "不向对手透露我的网络地址")}
        </label>
      </div>
      <p className="muted small">
        {tt(
          "Games normally link the two browsers directly, which shows each player's internet (IP) address to the other. With this on, your games go through our server instead. Players under 16 always play this way.",
          "对局通常让双方浏览器直接连接，这会让对方看到你的网络（IP）地址。开启后，你的对局将通过服务器中转。16 岁以下的棋手始终如此。",
        )}
      </p>

      <h2>{tt("Blocked players", "已屏蔽的棋手")}</h2>
      {blocks === null ? (
        <p className="muted">…</p>
      ) : blocks.length === 0 ? (
        <p className="muted">{tt("Nobody. Block a player from their profile.", "暂无。可在棋手资料页屏蔽对方。")}</p>
      ) : (
        <ul className="block-list">
          {blocks.map((b) => (
            <li key={b.username}>
              <a href={nav.href(`/player?u=${encodeURIComponent(b.username)}`)}>{b.username}</a>{" "}
              <button type="button" className="link" onClick={() => void unblock(b.username)}>
                {tt("Unblock", "取消屏蔽")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
