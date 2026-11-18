// Single source of truth for page metadata. Used by the app at runtime and by
// the Vite build (vite.config.ts) to pre-render per-route <head> tags, static
// fallback content, sitemap.xml and robots.txt.

/** Production origin. Change this if you deploy to a custom domain. */
export const SITE_URL = 'https://diffbit.vercel.app'
export const SITE_NAME = 'diffbit'

export type PageKey = 'json' | 'xml'

export type PageMeta = {
  path: string
  title: string
  description: string
  keywords: string
  h1: string
  intro: string
  faq: { q: string; a: string }[]
}

export const PAGES: Record<PageKey, PageMeta> = {
  json: {
    path: '/',
    title: 'JSON Diff Checker & Beautifier – Compare JSON Online | diffbit',
    description:
      'Compare two JSON files side by side and see every difference instantly. Beautify, validate and minify JSON with precise error locations. Free, fast and private – runs entirely in your browser.',
    keywords: 'json diff, json compare, compare json online, json diff checker, json beautifier, json formatter, json validator, json minify',
    h1: 'JSON Diff Checker',
    intro: 'Paste or drop two JSON documents to beautify them and compare side by side. Formatting and key order can be ignored so you only see real changes.',
    faq: [
      {
        q: 'How do I compare two JSON files?',
        a: 'Paste the original JSON on the left and the modified JSON on the right, or drop the files onto each editor. Differences appear instantly below, with changed words highlighted inside each line.',
      },
      {
        q: 'Can it compare minified or unformatted JSON?',
        a: 'Yes. With "Ignore formatting" enabled, both sides are beautified before comparison, so minified, single-line or oddly indented JSON is compared by structure rather than whitespace.',
      },
      {
        q: 'Does key order matter?',
        a: 'Turn on "Sort keys" to sort object keys alphabetically on both sides before diffing, so reordered keys are not reported as changes.',
      },
      {
        q: 'Is my data uploaded anywhere?',
        a: 'No. Formatting, validation and diffing all run locally in your browser. Your JSON never leaves your device.',
      },
    ],
  },
  xml: {
    path: '/xml-diff',
    title: 'XML Diff Checker & Formatter – Compare XML Online | diffbit',
    description:
      'Compare two XML files side by side and spot every difference. Pretty-print, validate and minify XML with exact line and column errors. Free, fast and private – runs entirely in your browser.',
    keywords: 'xml diff, xml compare, compare xml online, xml diff checker, xml formatter, xml beautifier, xml pretty print, xml validator',
    h1: 'XML Diff Checker',
    intro: 'Paste or drop two XML documents to pretty-print them and compare side by side. Indentation differences are ignored so you only see real changes.',
    faq: [
      {
        q: 'How do I compare two XML files?',
        a: 'Paste the original XML on the left and the modified XML on the right, or drop the files onto each editor. The diff updates as you type, with changed words highlighted inside each line.',
      },
      {
        q: 'Can it format minified XML?',
        a: 'Yes. Click Format (or press Shift+Alt+F) to pretty-print XML with your preferred indentation. Pasting into an empty editor formats it automatically.',
      },
      {
        q: 'Does it validate XML?',
        a: 'Every edit is checked for well-formedness. Errors show the exact line and column, and clicking the message jumps to the problem.',
      },
      {
        q: 'Is my data uploaded anywhere?',
        a: 'No. Everything runs locally in your browser. Your XML never leaves your device.',
      },
    ],
  },
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function pageUrl(key: PageKey) {
  return SITE_URL + PAGES[key].path
}

export function renderHead(key: PageKey) {
  const p = PAGES[key]
  const url = pageUrl(key)
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: p.h1,
      url,
      description: p.description,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ]
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta name="keywords" content="${esc(p.keywords)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}

/** Static fallback rendered inside #root so crawlers without JS still see real content. React replaces it on load. */
export function renderBody(key: PageKey) {
  const p = PAGES[key]
  const other: PageKey = key === 'json' ? 'xml' : 'json'
  return `<main style="max-width:720px;margin:48px auto;padding:0 16px;font-family:system-ui,sans-serif">
      <h1>${esc(p.h1)}</h1>
      <p>${esc(p.intro)}</p>
      ${p.faq.map((f) => `<h2>${esc(f.q)}</h2><p>${esc(f.a)}</p>`).join('\n      ')}
      <p><a href="${PAGES[other].path}">${esc(PAGES[other].h1)}</a></p>
    </main>`
}

export function renderSitemap() {
  const urls = (Object.keys(PAGES) as PageKey[]).map((k) => `  <url><loc>${pageUrl(k)}</loc><changefreq>monthly</changefreq><priority>${k === 'json' ? '1.0' : '0.9'}</priority></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
}
