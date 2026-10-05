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

## GitHub Pages (current setup)

`.github/workflows/pages.yml` publishes to https://jetzhu.github.io/xiangqi/ on every push to `main`.
It runs the unit tests, builds, checks the size budget and runs the end-to-end tests against the
build as Pages will serve it, then deploys.

- One-time setup: repo Settings → Pages → Source: **GitHub Actions**.
- Pages cannot set headers, so the build includes `coi-serviceworker`
  (`NEXT_PUBLIC_COI_SERVICE_WORKER=1`): on a visitor's first page load it installs a service
  worker that adds COOP/COEP, and the page reloads once. Browsers without service workers
  (some private modes) get the site without the engine.
- A project site lives under `/xiangqi`, set by `NEXT_PUBLIC_BASE_PATH`. Plain links and static
  files go through `withBase()` in `lib/site.ts`; the engine path comes from `nav.asset()`.
- `robots.txt` ends up at `/xiangqi/robots.txt`, where crawlers don't look; submit the sitemap
  (`/xiangqi/sitemap.xml`) in Search Console instead. A custom domain fixes both: set it in
  Pages settings and build with `NEXT_PUBLIC_BASE_PATH` empty and `NEXT_PUBLIC_SITE_URL` the domain.
- Test a Pages build locally:
  ```
  NEXT_PUBLIC_BASE_PATH=/xiangqi NEXT_PUBLIC_SITE_URL=https://jetzhu.github.io/xiangqi \
    NEXT_PUBLIC_COI_SERVICE_WORKER=1 pnpm --filter web build
  NEXT_PUBLIC_BASE_PATH=/xiangqi E2E_PAGES=1 pnpm --filter web e2e
  BASE_PATH=/xiangqi NO_HEADERS=1 pnpm --filter web serve   # http://127.0.0.1:4000/xiangqi/
  ```

## Other hosts: steps

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
