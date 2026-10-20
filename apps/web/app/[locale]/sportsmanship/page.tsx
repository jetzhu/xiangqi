import type { Metadata } from "next";
import { type Locale, pageMetadata } from "../../../lib/site";

// The sportsmanship policy for online games (v0.3; docs/v0.3-online-design.md, "Sportsmanship").
const UPDATED = "2026-10-19";

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
      <p className="muted">Last updated {UPDATED}</p>
      <p>
        A game is two people's time. Finishing it, win or lose, is part of playing fair. Your <strong>completion rate</strong> (棋品) is the share of your
        online games in the last 90 days that you played to a result. It counts from your first game, and everyone starts with a clean record worth 5
        finished games, so a single mishap early on doesn't count for much. It's on your profile, and other players may choose to play only people
        above a certain rate. Only your own actions change it. If a mark came from a fault on our side, write to us and a moderator will remove it.
      </p>

      <h2>What lowers it</h2>
      <ul>
        <li><strong>Abandoning:</strong> leaving a game and not coming back within the reconnect window.</li>
        <li><strong>Stalling:</strong> in a lost game, letting your clock run down instead of moving or resigning.</li>
        <li><strong>Aborting:</strong> calling off a game before the first moves, or not making your first move in time.</li>
      </ul>
      <p>
        <strong>Long first moves</strong> (more than half your starting time on one of your first 10 moves) are noted on your own record, but don't lower
        the rate: the game was still played.
      </p>

      <h2>Disconnects</h2>
      <p>
        Clocks never stop. If your connection drops, come back on any device within the reconnect window (a tenth of the game's expected length, from 30
        seconds to 3 minutes) and carry on. A dropped connection you return from doesn't count against you.
      </p>

      <h2>What happens</h2>
      <p>
        Penalties are private and start gently. Leaving or stalling a game, or aborting 4 of your last 10, brings a reminder you acknowledge. Doing it
        again within 3 days brings a wait before your next quick-pairing game (10 minutes, doubling for each repeat, never more than a day), and for those
        3 days you're matched with other players who do the same. Games with friends aren't held up.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help legal">
      <h1>棋品规则</h1>
      <p className="muted">更新于 {UPDATED}</p>
      <p>
        一盘棋占用的是两个人的时间。无论输赢都下完，是公平对弈的一部分。你的<strong>棋品（完成率）</strong>是最近 90 天内你下到出结果的在线对局所占的比例。它从你的第一盘棋开始计算，每个人起步时都相当于已经完整下完 5 盘，因此早期的一次意外影响不大。它显示在资料页上，其他棋手可以选择只与达到一定比例的棋手对局。只有你自己的行为会影响它。如果某个标记是我们这边的故障造成的，请联系我们，管理员会将其删除。
      </p>

      <h2>哪些行为会降低棋品</h2>
      <ul>
        <li><strong>弃局：</strong>离开对局，并且没有在重连时限内回来。</li>
        <li><strong>拖延：</strong>在输棋的局面下不走棋也不认输，任由时间耗尽。</li>
        <li><strong>取消对局：</strong>在开局前几步之前取消对局，或没有按时走出第一步。</li>
      </ul>
      <p><strong>开局长考</strong>（前 10 步中的某一步用掉一半以上的基本时间）会记在你自己的记录里，但不降低完成率，因为这盘棋还是下完了。</p>

      <h2>断线</h2>
      <p>计时不会停止。如果断线，请在重连时限内（对局预计时长的十分之一，30 秒到 3 分钟）用任意设备回来继续下。断线后按时回来，不会影响棋品。</p>

      <h2>处理方式</h2>
      <p>处理不公开，并且循序渐进。离开或拖延对局，或最近 10 盘中取消 4 盘，会收到一次需要你确认的提醒。3 天内再犯，下一盘快速匹配前需要等待（10 分钟，每再犯一次加倍，最长一天），并在这 3 天里与有同样行为的棋手匹配。与好友的对局不受影响。</p>
    </article>
  );
}
