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
  /** URL of a static file served with the site, e.g. "/engine/fairy". */
  asset: (path: string) => string;
}

export const hashNav: Nav = {
  href: (path) => `#${path}`,
  params: () => new URLSearchParams(typeof location === "undefined" ? "" : (location.hash.split("?")[1] ?? "")),
  replace: (path) => history.replaceState(null, "", `#${path}`),
  asset: (path) => path,
};

/**
 * Paths prefixed with a locale segment and ending in a slash before any query, e.g.
 * "/zh/analysis/?moves=…" (static hosting serves each page as a folder's index.html).
 * `base` is where the site lives, e.g. "/xiangqi" on GitHub Pages ("" at a domain's root).
 */
export function prefixNav(prefix: string, base = ""): Nav {
  const href = (path: string) => {
    const [p = "/", q] = path.split("?");
    const withSlash = p.endsWith("/") ? p : `${p}/`;
    return `${prefix}${withSlash}${q ? `?${q}` : ""}`;
  };
  return {
    href,
    params: () => new URLSearchParams(typeof location === "undefined" ? "" : location.search),
    replace: (path) => history.replaceState(null, "", href(path)),
    asset: (path) => `${base}${path}`,
  };
}

const NavContext = createContext<Nav>(hashNav);

export function NavProvider({ nav, children }: { nav: Nav; children: ReactNode }) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export const useNav = () => useContext(NavContext);
