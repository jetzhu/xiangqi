"use client";
// Header corner: Log in / Sign up for guests, a menu under the username once signed in.

import { useEffect, useId, useRef, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { useAccount } from "./session.js";

export function AccountMenu() {
  const account = useAccount();
  const nav = useNav();
  const { tt } = useT();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on a click elsewhere or Escape (focus back on the button).
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const { state } = account;
  if (state.status === "off" || state.status === "loading") return null;
  if (state.status === "guest") {
    const here = typeof location === "undefined" ? "" : location.pathname;
    // Stay on this page after logging in, unless it is one of the sign-in pages.
    const next = /\/(login|signup|reset-password|auth)\//.test(here) ? "" : `?next=${encodeURIComponent(here.replace(/^.*?\/(zh|en)(?=\/)/, ""))}`;
    return (
      <span className="account-links">
        <a href={`${nav.href("/login")}${next}`}>{tt("Log in", "登录")}</a>
        <a className="button primary small-button" href={nav.href("/signup")}>
          {tt("Sign up", "注册")}
        </a>
      </span>
    );
  }

  return (
    <div className="account-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="account-button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        <span className="account-avatar" aria-hidden>
          {state.user.username.slice(0, 1).toUpperCase()}
        </span>
        {state.user.username}
      </button>
      {open && (
        <ul id={menuId} className="account-dropdown">
          <li className="muted account-email">{state.user.email}</li>
          <li>
            <a href={nav.href("/stats")}>{tt("My stats", "我的统计")}</a>
          </li>
          <li>
            <a href={nav.href("/stats?tab=games")}>{tt("Game history", "对局记录")}</a>
          </li>
          <li>
            <a href={nav.href("/settings")}>{tt("Settings", "设置")}</a>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void account.signOut();
              }}
            >
              {tt("Sign out", "退出登录")}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
