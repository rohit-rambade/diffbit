import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { PAGES, renderBody, renderHead, renderRobots, renderSitemap, type PageKey } from './src/seo.ts'

const HEAD = '<!--app-head-->'
const BODY = '<!--app-body-->'
const fill = (html: string, key: PageKey) => html.replace(HEAD, renderHead(key)).replace(BODY, renderBody(key))
const pageFor = (url = '/'): PageKey => (url.startsWith(PAGES.xml.path) ? 'xml' : 'json')

/** Pre-renders one HTML file per route with its own <head> (title, description, canonical, JSON-LD). */
function seo(): Plugin[] {
  return [
    {
      name: 'diffbit-seo:dev',
      apply: 'serve',
      transformIndexHtml: (html, ctx) => fill(html, pageFor(ctx.originalUrl)),
    },
    {
      name: 'diffbit-seo:build',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        const index = bundle['index.html']
        if (!index || index.type !== 'asset') return
        const template = String(index.source)
        index.source = fill(template, 'json')
        this.emitFile({ type: 'asset', fileName: 'xml-diff/index.html', source: fill(template, 'xml') })
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap() })
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: renderRobots() })
      },
    },
  ]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), seo()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
