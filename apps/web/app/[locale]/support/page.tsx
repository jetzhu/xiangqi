import type { Metadata } from "next";
import { DonateButtons } from "../../../components/pages";
import { type Locale, pageMetadata } from "../../../lib/site";

// Rendered on the server so the promises are readable without running the app; only the buttons
// (links the moderators keep in site settings) come from the browser. docs/v0.4-design.md, M21.
const COSTS = "https://github.com/jetzhu/xiangqi/blob/main/docs/costs.md";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata("support", (await params).locale as Locale);
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  return (await params).locale === "zh" ? <Zh /> : <En />;
}

function En() {
  return (
    <article className="help support-page">
      <h1>Support Xiangqi School</h1>
      <p>
        <strong>Learning, playing, ratings, fair play and analysis are free for everyone, with no ads, forever.</strong> The site is run by one volunteer
        as a hobby. If it helps you, you can help pay for keeping it running.
      </p>
      <DonateButtons lang="en" />
      <h2>Good to know</h2>
      <ul>
        <li>A gift never unlocks anything in play: no features, no rating, no priority.</li>
        <li>Gifts go to a private person, not a charity, so they are not tax-deductible.</li>
        <li>Under 18? Please ask a parent first.</li>
        <li>Changed your mind? Ask for a refund within 30 days, from the contact in the privacy policy.</li>
        <li>Payments are handled by Stripe or GitHub; the site never sees your card or account details.</li>
      </ul>
      <h2>What it costs</h2>
      <p>
        Today the site costs <strong>$0 a month</strong>: it runs on the free plans of GitHub Pages and Supabase. If it outgrows them, a paid database
        plan costs from $25 a month, and a domain name about $11 a year, so about $310–430 a year. Gifts are kept for that. The{" "}
        <a href={COSTS}>spending report</a> shows what came in and what went out, every quarter.
      </p>
      <p>
        You can help in other ways too: <a href="../feedback/">tell us what to improve</a>, or share the site with someone learning Xiangqi.
      </p>
    </article>
  );
}

function Zh() {
  return (
    <article className="help support-page">
      <h1>支持象棋学堂</h1>
      <p>
        <strong>学棋、下棋、等级分、公平竞技和棋局分析，对所有人永久免费，没有广告。</strong>本站由一名志愿者业余维护。如果它对你有帮助，欢迎帮忙承担运行费用。
      </p>
      <DonateButtons lang="zh" />
      <h2>须知</h2>
      <ul>
        <li>捐助不会解锁任何对弈相关的内容：没有额外功能、不影响等级分、没有优先权。</li>
        <li>捐助给个人，而非慈善机构，因此不能抵税。</li>
        <li>未满 18 岁？请先征得家长同意。</li>
        <li>改变主意了？30 天内可通过隐私政策中的联系方式申请退款。</li>
        <li>付款由 Stripe 或 GitHub 处理；本站不会看到你的银行卡或账户信息。</li>
      </ul>
      <h2>运行费用</h2>
      <p>
        目前本站每月费用为 <strong>0 美元</strong>：使用 GitHub Pages 和 Supabase 的免费套餐。如果超出免费额度，付费数据库每月 25 美元起，域名每年约 11 美元，合计每年约 310–430 美元。捐款会留作这些用途。
        <a href={COSTS}>支出报告</a>每季度公布收入和支出。
      </p>
      <p>
        你也可以用其他方式帮忙：<a href="../feedback/">告诉我们哪里可以改进</a>，或把本站分享给正在学象棋的朋友。
      </p>
    </article>
  );
}
