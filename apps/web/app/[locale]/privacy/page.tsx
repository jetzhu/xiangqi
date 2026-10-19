import type { Metadata } from "next";
import { type Locale, pageMetadata } from "../../../lib/site";

// Rendered on the server, so anyone (and Google's consent-screen check) can read it without
// running the app. Keep it true to what the code does: packages/db holds what an account stores.
const UPDATED = "2026-10-18";
const CONTACT = "jianjetzhu@gmail.com";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("privacy", (await params).locale as Locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (await params).locale === "zh" ? <Zh /> : <En />;
}

function En() {
  return (
    <article className="help legal">
      <h1>Privacy policy</h1>
      <p className="muted">Last updated {UPDATED}</p>
      <p>
        Xiangqi School is a free site for learning and playing Xiangqi (Chinese chess), run as a personal project. This page says what it keeps about you,
        where, and why. In short: without an account everything stays in your browser; with an account we keep your email, username and your play, only to
        run the site. No ads, no tracking, nothing sold.
      </p>

      <h2>Without an account</h2>
      <p>
        Lesson progress, puzzle and bot ratings, game records, saved analyses and settings are stored in your own browser (IndexedDB and local storage).
        They are not sent to us. The engine runs in your browser too. Clearing the site's data in your browser deletes them.
      </p>
      <p>
        The site is hosted on GitHub Pages, which, like any web host, receives your IP address and browser details when pages load. See{" "}
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.
      </p>

      <h2>With an account</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address, username, the language you signed up in, and when the account was made; the avatar and
          country you may choose for your profile. A password, if you set one, is stored only as a hash.
        </li>
        <li>
          <strong>Sign-in with Google, Microsoft or GitHub:</strong> we receive your email address, name and profile picture link from that service. We
          use them only to sign you in and to suggest a username. We don't receive your password there, your contacts or anything else.
        </li>
        <li>
          <strong>Your play:</strong> lesson progress, settings, stars, streak days, games against bots, puzzle attempts, ratings and saved analyses.
        </li>
        <li>
          <strong>For online play:</strong> your birth month and year (no day), so that players under 16 get the protections below and lose them by themselves on turning 16; the players you block, the
          challenge links you make, and your online games: the moves, the clock readings each browser reported, whether your page lost focus during your turn, when each report reached us, the chat
          phrases each browser sent and received, and after a rated game each browser's engine analysis of it, used to
          settle results and for fair play (see the <a href="../fair-play/">fair play policy</a>), and what each game says about sportsmanship
          (left, stalled, aborted, or a very slow start; see the <a href="../sportsmanship/">sportsmanship policy</a>). While you look for a quick-pairing
          game, your rating, filters and the time you started are kept until you're paired or stop. Reports you make about
          another player, and reports about you, are kept with the moderators' decisions and an unchangeable log of every moderator action, so cases
          can be reviewed and appealed; reporters never see who else reported, and nobody sees report counts. A game's detailed record
          (the per-move reports, analyses and chat) is deleted 12 months after the game, unless a report, an undecided case or an appeal about
          one of its players is still open; the game itself (players, moves, result and rating change) stays in your history.
        </li>
      </ul>
      <p>
        Accounts are run by <a href="https://supabase.com/privacy">Supabase</a>, which stores this data for us in the United States (AWS, Oregon). Only
        you can read your account data from the site; the database's access rules block everyone else. The exception is your <strong>public profile</strong>,
        which anyone can see: your username, online ratings and completion rate (the share of your recent games you didn't leave, stall or abort), and, if you're 16 or older, your avatar, country and when you joined. Opponents see your avatar in a game only if you're 16 or older too.
      </p>
      <p>
        In online games the two players' browsers normally connect directly, which shows each player's internet (IP) address to the other. Settings →
        Online play → "Don't share my network address" sends your games through our server instead; players under 16 always play that way. To set
        up a direct connection, your browser asks a public STUN server (run by Google or Cloudflare) for its own internet address; that server sees
        your IP address but nothing about you or the game.
      </p>

      <h2>Google user data</h2>
      <p>
        Information received from Google is used only to sign you in to Xiangqi School. Our use and transfer of it adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use
        requirements. It is not shared with anyone, not used for advertising, and not used to train AI models.
      </p>

      <h2>What we don't do</h2>
      <p>No advertising, no analytics or tracking scripts, no tracking cookies, and we never sell or rent your data. Signing in uses your browser's local storage, not cookies.</p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep account data while the account exists. In Settings → Account you can download all of it as a JSON file, and delete your account: it is
        deleted 10 days after you ask (signing in before then cancels it), and then everything in it is gone for good. To correct anything else, email{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Children</h2>
      <p>
        Before an account is made we ask for your birth month and year and your country, and apply the minimum age there (13 in most places; 14 to 18 in
        some). Younger players can use everything as a guest, with their progress kept in their own browser; we don't keep the answer.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes, the date at the top changes too. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help legal">
      <h1>隐私政策</h1>
      <p className="muted">最后更新：{UPDATED}</p>
      <p>
        象棋学堂是一个免费学习和下中国象棋的网站，由个人维护。本页说明我们保存哪些关于你的信息、存在哪里以及用途。简而言之：不注册时，一切都只保存在你的浏览器里；注册后，我们保存你的邮箱、用户名和下棋记录，仅用于运行网站。没有广告，没有跟踪，不出售任何数据。
      </p>

      <h2>不注册账号时</h2>
      <p>课程进度、题目和人机等级分、对局记录、保存的分析和设置都保存在你自己的浏览器中（IndexedDB 和本地存储），不会发送给我们。引擎也在你的浏览器中运行。清除浏览器中本站的数据即可删除它们。</p>
      <p>
        本站托管在 GitHub Pages 上，与任何网站托管服务一样，加载页面时它会收到你的 IP 地址和浏览器信息。详见{" "}
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub 隐私声明</a>。
      </p>

      <h2>注册账号后</h2>
      <ul>
        <li>
          <strong>账号信息：</strong>邮箱地址、用户名、注册时使用的语言和注册时间；你可以为个人资料选择的头像和国家或地区。如果你设置了密码，只保存其哈希值。
        </li>
        <li>
          <strong>使用 Google、Microsoft 或 GitHub 登录：</strong>我们会从该服务收到你的邮箱地址、名字和头像链接，只用于登录和推荐用户名。我们不会收到你在那里的密码、联系人或其他信息。
        </li>
        <li>
          <strong>下棋记录：</strong>课程进度、设置、星级、连续学习天数、人机对局、题目记录、等级分和保存的分析。
        </li>
        <li>
          <strong>在线对弈：</strong>你的出生年月（不含日期），用于让 16 岁以下的棋手获得下述保护，并在年满 16 岁时自动解除；你屏蔽的棋手、你生成的挑战链接，以及你的在线对局：着法、双方浏览器报告的时钟读数、轮到你走时页面是否失去焦点、每份报告到达服务器的时间、双方浏览器发送和收到的快捷聊天，以及计分对局结束后双方浏览器的引擎分析，用于判定结果和公平竞技（见<a href="../fair-play/">公平竞技规则</a>），以及每盘对局的棋品记录（离开、拖延、取消或开局过慢，见<a href="../sportsmanship/">棋品规则</a>）。快速匹配时，你的等级分、筛选条件和开始时间会保存到匹配成功或停止寻找为止。你对其他棋手的举报、别人对你的举报，以及管理员的处理决定，会与一份不可修改的管理操作日志一起保存，以便复核和申诉；举报人看不到其他举报人，任何人都看不到举报次数。对局的详细记录（每步报告、引擎分析和聊天）在对局 12 个月后删除，除非与其中一方有关的举报、未结案件或申诉仍在进行；对局本身（双方、着法、结果和等级分变化）会保留在你的记录中。
        </li>
      </ul>
      <p>
        账号服务由 <a href="https://supabase.com/privacy">Supabase</a> 提供，数据存放在美国（AWS 俄勒冈）。只有你本人能在网站上读取自己的账号数据，数据库的访问规则会阻止其他所有人。例外是你的<strong>公开资料</strong>，任何人都能看到：用户名、在线等级分和完成率（最近对局中你没有离开、拖延或取消的比例）；如果你已满 16 岁，还有头像、国家或地区以及注册时间。对局中，对手也只有在你已满 16 岁时才能看到你的头像。
      </p>
      <p>
        在线对局时，双方浏览器通常会直接连接，这会让对方看到你的网络（IP）地址。在“设置 → 在线对弈”中开启“不向对手透露我的网络地址”后，你的对局将经服务器中转；16 岁以下的棋手始终如此。为了建立直接连接，你的浏览器会向公共 STUN 服务器（由 Google 或 Cloudflare 运营）查询自己的网络地址；该服务器能看到你的 IP 地址，但看不到你的身份或对局内容。
      </p>

      <h2>Google 用户数据</h2>
      <p>
        从 Google 获得的信息只用于让你登录象棋学堂。我们对这些信息的使用和传输遵守{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API 服务用户数据政策</a>，包括其中的“有限使用”要求：不与任何人分享，不用于广告，也不用于训练 AI 模型。
      </p>

      <h2>我们不做的事</h2>
      <p>没有广告，没有统计或跟踪脚本，没有跟踪 Cookie，也绝不出售或出租你的数据。登录状态保存在浏览器的本地存储中，而不是 Cookie。</p>

      <h2>保存与删除</h2>
      <p>
        账号存在期间我们会保存账号数据。在“设置 → 账号”中，你可以把全部数据下载为 JSON 文件，也可以删除账号：提出申请 10 天后删除（在此之前登录即可取消），届时账号中的所有数据将被永久删除。如需更正其他信息，请发邮件到{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。
      </p>

      <h2>儿童</h2>
      <p>注册账号前，我们会询问你的出生年月和所在国家或地区，并按当地的最低年龄执行（大多数地区为 13 岁，部分地区为 14 至 18 岁）。未达到年龄的棋友可以以访客身份使用全部功能，进度保存在自己的浏览器中；我们不会保存你的回答。</p>

      <h2>变更与联系</h2>
      <p>
        本政策如有变更，顶部日期会随之更新。如有疑问，请联系 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。
      </p>
    </article>
  );
}
