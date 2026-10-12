import type { Metadata } from "next";
import { type Locale, pageMetadata } from "../../../lib/site";

// The sportsmanship policy for online games (v0.3; docs/v0.3-online-design.md, "Sportsmanship").
const UPDATED = "2026-10-12";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("sportsmanship", (await params).locale as Locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (await params).locale === "zh" ? <Zh /> : <En />;
}

function En() {
  return (
    <article className="help legal">
      <h1>Sportsmanship policy</h1>
      <p className="muted">Last updated {UPDATED} · Online play opens with v0.3</p>
      <p>
        A game is two people's time. Finishing it, win or lose, is part of playing fair. Your <strong>completion rate</strong> (棋品) is the share of your
        online games in the last 90 days that you played to a result. It's on your profile, and other players may choose to play only people above a
        certain rate. Only your own actions change it.
      </p>

      <h2>What lowers it</h2>
      <ul>
        <li><strong>Abandoning:</strong> leaving a game and not coming back within the reconnect window.</li>
        <li><strong>Stalling:</strong> in a lost game, letting your clock run down instead of moving or resigning.</li>
        <li><strong>Frequent aborts:</strong> calling off many games before the first move once an opponent is found.</li>
        <li><strong>Long first moves:</strong> using more than half your starting time on one of your first 10 moves.</li>
      </ul>

      <h2>Disconnects</h2>
      <p>
        Clocks never stop. If your connection drops, come back on any device within the reconnect window (a tenth of the game's expected length, from 30
        seconds to 3 minutes) and carry on. A dropped connection you return from doesn't count against you.
      </p>

      <h2>What happens</h2>
      <p>
        Penalties are private and start gently: a reminder you acknowledge, then a short wait before your next game (10 minutes, longer for repeats within 3
        days, never more than a day), and matching with other players who do the same.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help legal">
      <h1>棋品规则</h1>
      <p className="muted">更新于 {UPDATED} · 在线对弈将在 v0.3 推出</p>
      <p>
        一盘棋占用的是两个人的时间。无论输赢都下完，是公平对弈的一部分。你的<strong>棋品（完成率）</strong>是最近 90 天内你下到出结果的在线对局所占的比例。它显示在资料页上，其他棋手可以选择只与达到一定比例的棋手对局。只有你自己的行为会影响它。
      </p>

      <h2>哪些行为会降低棋品</h2>
      <ul>
        <li><strong>弃局：</strong>离开对局，并且没有在重连时限内回来。</li>
        <li><strong>拖延：</strong>在输棋的局面下不走棋也不认输，任由时间耗尽。</li>
        <li><strong>频繁取消对局：</strong>匹配到对手后，在第一步之前多次取消对局。</li>
        <li><strong>开局长考：</strong>在前 10 步中的某一步用掉一半以上的基本时间。</li>
      </ul>

      <h2>断线</h2>
      <p>计时不会停止。如果断线，请在重连时限内（对局预计时长的十分之一，30 秒到 3 分钟）用任意设备回来继续下。断线后按时回来，不会影响棋品。</p>

      <h2>处理方式</h2>
      <p>处理不公开，并且循序渐进：先是需要你确认的提醒，然后是下一局前的短暂等待（10 分钟；3 天内再犯会延长，最长一天），并与有同样行为的棋手匹配。</p>
    </article>
  );
}
