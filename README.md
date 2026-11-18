# diffbit

Fast, private JSON & XML diff checker with a built-in beautifier. Everything runs in the browser.

- **Beautify / minify / validate** JSON and XML (exact line + column errors, click to jump)
- **Auto-format on paste** and on file open / drag-and-drop
- **Semantic compare** – "Ignore formatting" beautifies both sides first; "Sort keys" ignores JSON key order
- Split & unified views, word-level change highlights, collapse unchanged lines, jump between changes
- Lossless JSON formatting (big numbers and key order preserved)

Routes: `/` (JSON diff) and `/xml-diff` (XML diff). Each is pre-rendered at build time with its own
title, description, canonical URL and JSON-LD; `sitemap.xml` and `robots.txt` are generated too.
SEO copy lives in `src/seo.ts` – set `SITE_URL` there if you use a custom domain.

## Develop

```bash
npm install
npm run dev
```

## Analytics

Uses [Vercel Web Analytics](https://vercel.com/docs/analytics). Enable it in the Vercel project
dashboard (Analytics tab); custom events: `format`, `minify`, `sample`, `copy_diff`.
