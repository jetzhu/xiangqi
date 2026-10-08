import type { Metadata } from "next";
import { type Locale, pageMetadata } from "../../../lib/site";

// Rendered on the server, so anyone (and Google's consent-screen check) can read it without
// running the app. Keep it true to what the code does: packages/db holds what an account stores.
const UPDATED = "2026-10-08";
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
          <strong>Account details:</strong> your email address, username, the language you signed up in, and when the account was made. A password, if you
          set one, is stored only as a hash.
        </li>
        <li>
          <strong>Sign-in with Google, Microsoft or GitHub:</strong> we receive your email address, name and profile picture link from that service. We
          use them only to sign you in and to suggest a username. We don't receive your password there, your contacts or anything else.
        </li>
        <li>
          <strong>Your play</strong> (as these features arrive): lesson progress, settings, games against bots, puzzle attempts, ratings and saved
          analyses.
        </li>
      </ul>
      <p>
        Accounts are run by <a href="https://supabase.com/privacy">Supabase</a>, which stores this data for us in the United States (AWS, Oregon). Only
        you can read your account data from the site; the database's access rules block everyone else.
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
        We keep account data while the account exists. To see, correct, download or delete it, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>; a delete
        button in Settings is coming. Deleting an account removes its profile, progress, games and ratings.
      </p>

      <h2>Children</h2>
      <p>If you are under 13, or under the minimum age for online accounts where you live, please ask a parent or guardian before creating an account.</p>

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
          <strong>账号信息：</strong>邮箱地址、用户名、注册时使用的语言和注册时间。如果你设置了密码，只保存其哈希值。
        </li>
        <li>
          <strong>使用 Google、Microsoft 或 GitHub 登录：</strong>我们会从该服务收到你的邮箱地址、名字和头像链接，只用于登录和推荐用户名。我们不会收到你在那里的密码、联系人或其他信息。
        </li>
        <li>
          <strong>下棋记录</strong>（随功能上线）：课程进度、设置、人机对局、题目记录、等级分和保存的分析。
        </li>
      </ul>
      <p>
        账号服务由 <a href="https://supabase.com/privacy">Supabase</a> 提供，数据存放在美国（AWS 俄勒冈）。只有你本人能在网站上读取自己的账号数据，数据库的访问规则会阻止其他所有人。
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
        账号存在期间我们会保存账号数据。如需查看、更正、下载或删除，请发邮件到 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>；“设置”中的删除按钮即将上线。删除账号会移除其资料、进度、对局和等级分。
      </p>

      <h2>儿童</h2>
      <p>如果你未满 13 岁，或未达到所在地区注册网络账号的最低年龄，请在家长或监护人同意后再注册。</p>

      <h2>变更与联系</h2>
      <p>
        本政策如有变更，顶部日期会随之更新。如有疑问，请联系 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。
      </p>
    </article>
  );
}
