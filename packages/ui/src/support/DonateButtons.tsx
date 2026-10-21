"use client";
// The Support page's donation buttons (M21), from the links the moderators keep in site
// settings. A button stays hidden until its link is set, and nothing shows without the server.
import { useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { type DonationLinks, siteDonations } from "../online/api.js";

export function DonateButtons({ lang }: { lang: "en" | "zh" }) {
  const account = useAccount();
  const [links, setLinks] = useState<DonationLinks | null>(null);
  useEffect(() => {
    if (account.state.status === "loading" || account.state.status === "off") return;
    void account
      .client()
      .then(siteDonations)
      .then(setLinks, () => {});
  }, [account]);
  const zh = lang === "zh";
  if (!links || (!links.stripe && !links.github)) {
    return <p className="muted donate-none">{zh ? "捐助方式即将开通。" : "Ways to give are coming soon."}</p>;
  }
  return (
    <div className="donate-buttons">
      {links.stripe && (
        <a className="button primary" href={links.stripe} target="_blank" rel="noopener noreferrer">
          {zh ? "捐助（银行卡、支付宝、微信支付）" : "Give once (card, Alipay, WeChat Pay)"}
        </a>
      )}
      {links.github && (
        <a className="button" href={links.github} target="_blank" rel="noopener noreferrer">
          {zh ? "在 GitHub Sponsors 上赞助" : "Sponsor on GitHub"}
        </a>
      )}
    </div>
  );
}
