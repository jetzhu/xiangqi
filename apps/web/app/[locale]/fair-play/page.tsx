import type { Metadata } from "next";
import { type Locale, pageMetadata } from "../../../lib/site";

// The fair-play policy for online games (v0.3; docs/v0.3-online-design.md, "Fair play").
// Rendered on the server so it can be read without running the app. Exact detection
// thresholds stay private, as on every big site.
const UPDATED = "2026-10-16";
const CONTACT = "jianjetzhu@gmail.com";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("fairPlay", (await params).locale as Locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (await params).locale === "zh" ? <Zh /> : <En />;
}

function En() {
  return (
    <article className="help legal">
      <h1>Fair play policy</h1>
      <p className="muted">Last updated {UPDATED}</p>
      <p>
        Online games are between you and the other player: no engine, no helper, no second account. This page says what's forbidden, what we record to
        check it, and how decisions and appeals work. Our aim is to stop cheating paying off without making honest players feel watched or accused.
      </p>

      <h2>Not allowed during an online game</h2>
      <ul>
        <li>Engines, bots, apps, browser extensions or websites that suggest or evaluate moves, including relaying moves from another device.</li>
        <li>Help from another person, or another person playing on your account.</li>
        <li>Opening books, databases or this site's own analysis board on the game in progress. Analysis unlocks when the game ends.</li>
        <li>Losing on purpose, agreeing results, or using several accounts to change ratings.</li>
      </ul>
      <p>Looking back at your own games afterwards, with any tool you like, is fine and encouraged.</p>

      <h2>What we record</h2>
      <ul>
        <li>For every move: when our server received it, how long you thought, and whether the page lost focus while it was your move.</li>
        <li>
          After the game: an engine analysis of the moves, made in the two players' browsers, which you also get as your Game Review. For rated games
          your browser sends it to us, and we compare it with your opponent's.
        </li>
      </ul>
      <p>We don't record mouse movement, your clipboard, other programs or your camera.</p>

      <h2>How games are checked</h2>
      <ul>
        <li>Your play is compared with honest players of the same rating and speed, over many games. One game proves nothing, and nobody is judged on a single strong game.</li>
        <li>Signals include accuracy, time spent against how hard the move was, and how often the page lost focus. The exact thresholds aren't published.</li>
        <li>A report from an opponent starts a review; it never decides one. However many reports a player gets, nothing happens unless the evidence confirms it.</li>
        <li>A person confirms every finding before anything public happens.</li>
      </ul>

      <h2>Reports</h2>
      <p>
        Only a player of a game can report it, within 7 days. You'll get a message if action is taken, without details, and the rating you lost to that
        player back. Report counts are never shown on profiles.
      </p>

      <h2>What happens</h2>
      <ul>
        <li>While a case is under review, the player may be matched only with other players under review. Nothing is shown publicly.</li>
        <li>A first confirmed violation: rated online play suspended for 30 days, ratings reset, a public mark on the profile for a year, and ratings refunded to the opponents.</li>
        <li>A second confirmed violation: online play suspended at once, and the account closed for online play if no appeal succeeds within 30 days.</li>
      </ul>

      <h2>Appeals</h2>
      <p>
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> within 30 days. Every appeal is reviewed again with fresh eyes, and at the second level no
        closure is final before the appeal is decided.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help legal">
      <h1>公平竞技规则</h1>
      <p className="muted">更新于 {UPDATED}</p>
      <p>
        在线对局只属于你和对手：不用引擎、不找人帮忙、不用第二个账号。本页说明哪些行为被禁止、我们为核查记录什么，以及如何判定和申诉。我们的目标是让作弊得不偿失，同时不让诚实的棋手感到被监视或被冤枉。
      </p>

      <h2>在线对局中禁止</h2>
      <ul>
        <li>使用会提示或评估着法的引擎、机器人、应用、浏览器插件或网站，包括从另一台设备转述着法。</li>
        <li>接受他人帮助，或让他人用你的账号下棋。</li>
        <li>对进行中的对局使用开局库、棋谱库或本站分析棋盘。对局结束后分析功能即开放。</li>
        <li>故意输棋、商定结果，或用多个账号操纵等级分。</li>
      </ul>
      <p>对局结束后，用任何工具复盘自己的棋都可以，我们也鼓励这样做。</p>

      <h2>我们记录什么</h2>
      <ul>
        <li>每一步：服务器收到的时间、你的思考时间，以及轮到你走时页面是否离开过焦点。</li>
        <li>对局结束后：由双方浏览器完成的引擎分析，你也会把它作为复盘结果看到。计分对局的分析会由你的浏览器发送给我们，并与对手的分析核对。</li>
      </ul>
      <p>我们不记录鼠标移动、剪贴板、其他程序或摄像头。</p>

      <h2>如何核查</h2>
      <ul>
        <li>你的表现会与同等级分、同类对局中的诚实棋手比较，并且看许多盘棋。一盘棋说明不了什么，没有人会因为下了一盘好棋而被判定。</li>
        <li>参考的信号包括准确度、思考时间与局面难度的关系，以及页面离开焦点的频率。具体阈值不公开。</li>
        <li>对手的举报只会启动核查，不会决定结果。无论被举报多少次，没有证据证实就不会有任何处理。</li>
        <li>任何结论公开之前，都必须经过人工确认。</li>
      </ul>

      <h2>举报</h2>
      <p>只有对局双方可以在 7 天内举报该对局。如果采取了措施，你会收到通知（不含细节），输给该棋手的等级分也会退还。举报次数永远不会显示在资料页上。</p>

      <h2>处理方式</h2>
      <ul>
        <li>核查期间，该棋手可能只会与其他正在核查的棋手匹配，不会公开显示任何信息。</li>
        <li>第一次经确认违规：暂停计分在线对弈 30 天，等级分重置，资料页公开标记一年，并向对手退还等级分。</li>
        <li>第二次经确认违规：立即暂停在线对弈；30 天内申诉未成功的，关闭该账号的在线对弈。</li>
      </ul>

      <h2>申诉</h2>
      <p>
        请在 30 天内发邮件至 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。每次申诉都会由人重新审查；第二次违规时，申诉结果出来之前不会最终关闭账号。
      </p>
    </article>
  );
}
