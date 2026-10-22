"use client";
// The links at the foot of every page: feedback and support (M21), and the policies.
import { useAccount } from "./account/session.js";
import { useNav } from "./nav.js";
import { useT } from "./settings.js";

export function SiteFooter() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  // Child profiles (M24) see nothing about money.
  const child = account.state.status === "signedIn" && account.state.user.child;
  return (
    <footer className="site-footer">
      <a href={nav.href("/feedback")}>{tt("Feedback", "意见反馈")}</a>
      {!child && <a href={nav.href("/support")}>{tt("Support us", "支持我们")}</a>}
      <a href={nav.href("/privacy")}>{tt("Privacy", "隐私政策")}</a>
      <a href={nav.href("/terms")}>{tt("Terms", "使用条款")}</a>
    </footer>
  );
}
