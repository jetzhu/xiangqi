import type { ReactNode } from "react";

// No COOP/COEP service worker here: this page only redirects, and registering the worker
// just before leaving races with the next page's own registration.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
