"use client";
// The operator's contact block (privacy policy): name, postal address, phone and email, as the
// moderators keep them in the database. The page is static, so it starts from the values it was
// built with and shows the current ones once they arrive.
import { useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { type OperatorContact as Contact, siteContact } from "./api.js";

export const DEFAULT_CONTACT: Contact = { name: "Xiangqi School 象棋学堂", address: "P.O. Box 10000, Cupertino, CA 95014, USA", phone: null, email: "jianjetzhu@gmail.com" };

export function OperatorContact({ lang }: { lang: "en" | "zh" }) {
  const account = useAccount();
  const [c, setC] = useState<Contact>(DEFAULT_CONTACT);
  useEffect(() => {
    if (account.state.status === "loading" || account.state.status === "off") return;
    void account
      .client()
      .then(siteContact)
      .then((x) => x && setC(x), () => {});
  }, [account]);
  const zh = lang === "zh";
  return (
    <address className="operator-contact">
      {zh ? "运营方" : "Operator"}: {c.name}
      <br />
      {zh ? "通信地址" : "Postal address"}: {c.address}
      {c.phone && (
        <>
          <br />
          {zh ? "电话" : "Phone"}: {c.phone}
        </>
      )}
      <br />
      {zh ? "邮箱" : "Email"}: <a href={`mailto:${c.email}`}>{c.email}</a>
    </address>
  );
}
