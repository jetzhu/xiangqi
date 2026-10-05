# Deploying the website

The site is a static export: `pnpm --filter web build` writes plain files to `apps/web/out/`.
Any static host works if it can set response headers.

## Required headers

The engine runs threads (SharedArrayBuffer), which browsers allow only on
cross-origin-isolated pages. Every response must carry:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them the site still works, but the analysis board and bots cannot load the engine.
Check after deploying: open the browser console on any page and run `crossOriginIsolated`; it must print `true`.

Because of `require-corp`, the site cannot embed third-party scripts, images or iframes
unless they send `Cross-Origin-Resource-Policy: cross-origin` (or CORS). Keep this in mind
for analytics, ads and video embeds.

Header configs are already in the repo:

| Host | File |
| --- | --- |
| Cloudflare Pages, Netlify | `public/_headers` (copied into `out/`) |
| Vercel | `vercel.json` |
| nginx / others | add the two headers to every location |

## Steps

1. Set the public address, used for canonical links, hreflang and the sitemap:
   `NEXT_PUBLIC_SITE_URL=https://your-domain` (no trailing slash).
2. Build: `pnpm install && NEXT_PUBLIC_SITE_URL=… pnpm --filter web build`.
3. Check: `pnpm --filter web budget` and `pnpm --filter web e2e` (uses the system Chrome).
4. Upload `apps/web/out/`. For Cloudflare Pages: build command as in step 2, output directory `apps/web/out`.
5. In the deployed site: confirm `crossOriginIsolated === true`, `/sitemap.xml` and `/robots.txt` load,
   and that `/` sends you to `/zh/` or `/en/`.
6. Submit the sitemap to Google Search Console and Baidu Webmaster Tools.

## Notes for mainland China

Cloudflare and Vercel are reachable but slow or unreliable from mainland China. For Chinese
users at scale, use a mainland CDN (Alibaba Cloud OSS + CDN, Tencent COS + CDN), which needs
an ICP filing for the domain. The same `out/` folder and the two headers apply.

## Local preview

`pnpm --filter web serve` serves `out/` on http://127.0.0.1:4000 with the production headers.
