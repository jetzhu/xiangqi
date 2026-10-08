import type { Metadata } from "next";
import { type Locale, pageMetadata, withBase } from "../../../lib/site";

const UPDATED = "2026-10-08";
const CONTACT = "jianjetzhu@gmail.com";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("terms", (await params).locale as Locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (await params).locale === "zh" ? <Zh /> : <En />;
}

function En() {
  return (
    <article className="help legal">
      <h1>Terms of use</h1>
      <p className="muted">Last updated {UPDATED}</p>
      <p>Xiangqi School is a free personal project. By using it, or creating an account, you agree to these terms.</p>
      <h2>Using the site</h2>
      <ul>
        <li>Everything on the site is free to use, with or without an account.</li>
        <li>Keep your sign-in details to yourself; you are responsible for what happens under your account.</li>
        <li>
          Usernames must not insult anyone, impersonate others (including staff and the site's bots) or include anything illegal. We may rename or remove
          accounts that break this.
        </li>
        <li>Don't attack the site, try to reach other people's data, or overload it with automated requests.</li>
      </ul>
      <h2>Your data</h2>
      <p>
        What we keep and why is in the <a href={withBase("/en/privacy/")}>privacy policy</a>. You can ask for your account to be deleted at any time.
      </p>
      <h2>Content and software</h2>
      <p>
        Lessons are written for this site. Puzzles include positions from XiangqiBench (MIT licence). The engine is Fairy-Stockfish, and puzzles were checked with
        Pikafish (both GPL-3.0); see <a href={withBase("/en/help/")}>Help</a> for credits and links to their source.
      </p>
      <h2>No warranty</h2>
      <p>
        The site is provided as it is, without any warranty. Features may change or stop, and ratings and records may be reset, for example while accounts
        are new. To the extent the law allows, we are not liable for any loss from using the site.
      </p>
      <h2>Changes and contact</h2>
      <p>
        If these terms change, the date at the top changes too. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help legal">
      <h1>使用条款</h1>
      <p className="muted">最后更新：{UPDATED}</p>
      <p>象棋学堂是一个免费的个人项目。使用本站或注册账号，即表示你同意以下条款。</p>
      <h2>使用本站</h2>
      <ul>
        <li>无论是否注册，本站所有功能均可免费使用。</li>
        <li>请妥善保管登录信息；你的账号下发生的行为由你负责。</li>
        <li>用户名不得侮辱他人、冒充他人（包括工作人员和本站的机器人），也不得含有违法内容。违反者的账号可能被改名或删除。</li>
        <li>不得攻击本站、试图获取他人数据，或用自动化请求使网站过载。</li>
      </ul>
      <h2>你的数据</h2>
      <p>
        我们保存哪些数据及其用途，见<a href={withBase("/zh/privacy/")}>隐私政策</a>。你可以随时要求删除账号。
      </p>
      <h2>内容与软件</h2>
      <p>
        课程为本站编写。题目包含来自 XiangqiBench（MIT 许可）的局面。引擎为 Fairy-Stockfish，题目用 Pikafish 验证（均为 GPL-3.0），致谢和源代码链接见<a href={withBase("/zh/help/")}>帮助</a>。
      </p>
      <h2>免责声明</h2>
      <p>本站按现状提供，不作任何保证。功能可能变更或停止，等级分和记录也可能被重置（例如在账号功能刚上线期间）。在法律允许的范围内，我们不对使用本站造成的任何损失负责。</p>
      <h2>变更与联系</h2>
      <p>
        条款如有变更，顶部日期会随之更新。如有疑问，请联系 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>。
      </p>
    </article>
  );
}
