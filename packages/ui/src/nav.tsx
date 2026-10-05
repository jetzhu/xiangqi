"use client";
// Navigation that works under different routers: the playground uses "#/analysis" hash
// routes, the website uses "/zh/analysis". Pages speak in app paths like "/analysis?moves=…".

import { type ReactNode, createContext, useContext } from "react";

export interface Nav {
  /** Link for an app path such as "/analysis?moves=h2e2". */
  href: (path: string) => string;
  /** Query parameters of the current page. */
  params: () => URLSearchParams;
  /** Replace the current address without navigating (e.g. to keep a share link current). */
  replace: (path: string) => void;
}

export const hashNav: Nav = {
  href: (path) => `#${path}`,
  params: () => new URLSearchParams(typeof location === "undefined" ? "" : (location.hash.split("?")[1] ?? "")),
  replace: (path) => history.replaceState(null, "", `#${path}`),
};

/** Paths prefixed with a locale segment, e.g. "/zh/analysis". */
export function prefixNav(prefix: string): Nav {
  return {
    href: (path) => `${prefix}${path}`,
    params: () => new URLSearchParams(typeof location === "undefined" ? "" : location.search),
    replace: (path) => history.replaceState(null, "", `${prefix}${path}`),
  };
}

const NavContext = createContext<Nav>(hashNav);

export function NavProvider({ nav, children }: { nav: Nav; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export const useNav = () => useContext(NavContext);
