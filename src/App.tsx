import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { track } from '@vercel/analytics'
import { ArrowLeftRight, ChevronDown, ChevronUp, Copy, Moon, Sun } from 'lucide-react'
import { CodeEditor } from '@/components/CodeEditor'
import { DiffView, type ViewMode } from '@/components/DiffView'
import { diffLines, toPatch } from '@/lib/diff'
import { formatLang as format, LANG_ORDER, LANGS, validateLang as validate } from '@/lib/langs'
import { SAMPLES } from '@/lib/samples'
import type { Lang } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PAGES, pageUrl } from '@/seo'

type Indent = '2' | '4' | 'tab'
type Prefs = { indent: Indent; view: ViewMode; wrap: boolean; collapse: boolean; normalize: Record<Lang, boolean>; sortKeys: boolean; ignoreWs: boolean; ignoreCase: boolean }

const DEFAULT_NORMALIZE = Object.fromEntries(LANG_ORDER.map((l) => [l, LANGS[l].normalizeByDefault])) as Record<Lang, boolean>
const DEFAULT_PREFS: Prefs = { indent: '2', view: 'split', wrap: true, collapse: true, normalize: DEFAULT_NORMALIZE, sortKeys: false, ignoreWs: false, ignoreCase: false }
const INDENTS: Record<Indent, string> = { '2': '  ', '4': '    ', tab: '\t' }

const langFromPath = (path: string): Lang => LANG_ORDER.find((l) => PAGES[l].path !== '/' && path.startsWith(PAGES[l].path)) ?? 'json'
const EMPTY_DOCS = Object.fromEntries(LANG_ORDER.map((l) => [l, ['', '']])) as Record<Lang, [string, string]>

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem('diffbit-prefs') ?? '{}')
    // Older versions stored a single boolean for "Ignore formatting".
    const normalize = typeof saved.normalize === 'object' && saved.normalize ? { ...DEFAULT_NORMALIZE, ...saved.normalize } : DEFAULT_NORMALIZE
    return { ...DEFAULT_PREFS, ...saved, normalize }
  } catch {
    return DEFAULT_PREFS
  }
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => langFromPath(location.pathname))
  const [docs, setDocs] = useState<Record<Lang, [string, string]>>(EMPTY_DOCS)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [toast, setToast] = useState('')
  const [cursorState, setCursorState] = useState<{ of: unknown; i: number }>({ of: null, i: -1 })
  const diffRef = useRef<HTMLDivElement>(null)

  const [left, right] = docs[lang]
  const info = LANGS[lang]
  const normalize = info.formats && prefs.normalize[lang]
  const ignoreCase = info.caseOption && prefs.ignoreCase
  const indent = INDENTS[prefs.indent]
  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [key]: value }))
  const setSide = useCallback((side: 0 | 1, value: string) => setDocs((d) => ({ ...d, [lang]: side === 0 ? [value, d[lang][1]] : [d[lang][0], value] })), [lang])
  const notify = useCallback((msg: string) => setToast(msg), [])

  // ---- persistence & document metadata ----
  useEffect(() => {
    try {
      localStorage.setItem('diffbit-prefs', JSON.stringify(prefs))
    } catch {
      /* storage unavailable */
    }
  }, [prefs])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('diff-theme', dark ? 'dark' : 'light')
    } catch {
      /* storage unavailable */
    }
  }, [dark])

  useEffect(() => {
    const page = PAGES[lang]
    document.title = page.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description)
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', pageUrl(lang))
  }, [lang])

  useEffect(() => {
    const onPop = () => setLang(langFromPath(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  // ---- derived: validation + diff (deferred so typing stays responsive) ----
  const dLeft = useDeferredValue(left)
  const dRight = useDeferredValue(right)
  const leftError = useMemo(() => validate(lang, dLeft), [lang, dLeft])
  const rightError = useMemo(() => validate(lang, dRight), [lang, dRight])

  const result = useMemo(() => {
    if (!dLeft.trim() || !dRight.trim()) return null
    const prep = (s: string) => (normalize ? format(lang, s, indent, lang === 'json' && prefs.sortKeys).output : s.replace(/\r\n?/g, '\n'))
    return diffLines(prep(dLeft), prep(dRight), prefs.ignoreWs, ignoreCase)
  }, [dLeft, dRight, lang, indent, normalize, prefs.sortKeys, prefs.ignoreWs, ignoreCase])


  // Reset change-navigation position whenever the diff changes.
  const cursor = cursorState.of === result ? cursorState.i : -1
  const setCursor = (i: number) => setCursorState({ of: result, i })

  // ---- actions ----
  const switchLang = (next: Lang) => {
    if (next === lang) return
    history.pushState(null, '', PAGES[next].path)
    setLang(next)
  }

  const beautify = (side: 0 | 1, minify = false) => {
    const value = docs[lang][side]
    if (!value.trim()) return
    const r = format(lang, value, minify ? '' : indent)
    setSide(side, r.output)
    track(minify ? 'minify' : 'format', { lang })
    notify(r.error ? `Formatted, but input has errors: ${r.error.message}` : minify ? 'Minified' : 'Formatted')
  }

  const formatOnPaste = useCallback(
    (text: string) => {
      if (!text.trim() || !LANGS[lang].formatOnPaste) return null
      const r = format(lang, text, indent)
      if (r.error) notify(`Formatted, but input has errors: ${r.error.message}`)
      return r.output
    },
    [lang, indent, notify],
  )

  const loadSample = () => {
    const [a, b] = SAMPLES[lang]
    const prep = (s: string) => (info.formatOnPaste ? format(lang, s, indent).output : s)
    setDocs((d) => ({ ...d, [lang]: [prep(a), prep(b)] }))
    track('sample', { lang })
  }

  const copyPatch = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(toPatch(result))
      notify('Diff copied')
      track('copy_diff', { lang })
    } catch {
      notify('Copy failed')
    }
  }

  const jump = (dir: 1 | -1) => {
    const anchors = diffRef.current?.querySelectorAll<HTMLElement>('[data-change]')
    if (!anchors?.length) return
    const next = cursor < 0 ? (dir === 1 ? 0 : anchors.length - 1) : (cursor + dir + anchors.length) % anchors.length
    setCursor(next)
    const el = anchors[next]
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }

  const page = PAGES[lang]
  const changes = result ? result.adds + result.dels + result.chgs : 0
  const blocks = useMemo(() => (result ? result.rows.filter((r, i) => r.t !== 'eq' && (i === 0 || result.rows[i - 1].t === 'eq')).length : 0), [result])
  const label = lang === 'text' ? 'text' : info.label
  const tagline = lang === 'text' ? 'Compare any two texts or files line by line' : lang === 'sql' ? 'Compare and beautify SQL scripts and stored procedures' : `Beautify, validate and compare ${label}`

  return (
    <div className="min-h-screen bg-bg text-textx">
      <header className="sticky top-0 z-30 border-b border-borderx bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4">
          <a href="/" onClick={(e) => (e.preventDefault(), switchLang('json'))} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="h-1.5 w-1.5 rounded-full bg-textx" />
            diffbit
          </a>
          <nav className="flex rounded-lg border border-borderx bg-surface p-0.5" aria-label="Format">
            {LANG_ORDER.map((l) => (
              <a
                key={l}
                href={PAGES[l].path}
                onClick={(e) => {
                  e.preventDefault()
                  switchLang(l)
                }}
                aria-current={lang === l ? 'page' : undefined}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium sm:px-3.5 text-mutedx transition hover:text-textx', lang === l && 'bg-textx text-bg hover:text-bg')}
              >
                {LANGS[l].label}
              </a>
            ))}
          </nav>
          <button onClick={() => setDark((d) => !d)} className="flex h-8 w-8 items-center justify-center rounded-lg text-mutedx transition hover:bg-surface2 hover:text-textx" aria-label="Toggle dark mode">
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-4 pt-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{page.h1}</h1>
            <p className="mt-0.5 text-[13px] text-mutedx">{tagline} — everything stays in your browser.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {info.formats && <Segmented label="Indent" value={prefs.indent} onChange={(v) => setPref('indent', v)} options={[['2', '2'], ['4', '4'], ['tab', 'Tab']]} />}
            <Btn onClick={() => setDocs((d) => ({ ...d, [lang]: [d[lang][1], d[lang][0]] }))} title="Swap original and modified">
              <ArrowLeftRight size={13} /> Swap
            </Btn>
            <Btn onClick={loadSample}>Sample</Btn>
            <Btn onClick={() => setDocs((d) => ({ ...d, [lang]: ['', ''] }))}>Clear</Btn>
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-2" aria-label="Editors">
          {([0, 1] as const).map((side) => (
            <div key={side} className="flex h-[clamp(280px,44vh,560px)]">
              <CodeEditor
                lang={lang}
                label={side === 0 ? 'Original' : 'Modified'}
                value={docs[lang][side]}
                onChange={(v) => setSide(side, v)}
                error={side === 0 ? leftError : rightError}
                onFormat={() => beautify(side)}
                onMinify={() => beautify(side, true)}
                formatOnPaste={formatOnPaste}
                onNotify={notify}
              />
            </div>
          ))}
        </section>

        <section ref={diffRef} className="mt-4 rounded-xl border border-borderx bg-surface" aria-label="Differences">
          <div className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-xl border-b border-borderx bg-surface px-3 py-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-medium">Differences</h2>
              {result && (
                <div className="flex gap-1 text-[11px] font-medium tabular-nums">
                  <Chip cls="add">+{result.adds + result.chgs}</Chip>
                  <Chip cls="del">−{result.dels + result.chgs}</Chip>
                </div>
              )}
              {result && blocks > 0 && (
                <div className="flex items-center">
                  <IconBtn onClick={() => jump(-1)} title="Previous change">
                    <ChevronUp size={14} />
                  </IconBtn>
                  <span className="min-w-[3.5rem] text-center text-[11px] tabular-nums text-mutedx">
                    {cursor < 0 ? '–' : cursor + 1} / {blocks}
                  </span>
                  <IconBtn onClick={() => jump(1)} title="Next change">
                    <ChevronDown size={14} />
                  </IconBtn>
                </div>
              )}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {info.formats && (
                <Toggle on={normalize} onClick={() => setPref('normalize', { ...prefs.normalize, [lang]: !normalize })} title="Beautify both sides before comparing">
                  Ignore formatting
                </Toggle>
              )}
              {lang === 'json' && (
                <Toggle on={prefs.sortKeys} onClick={() => setPref('sortKeys', !prefs.sortKeys)} title="Sort object keys before comparing" disabled={!normalize}>
                  Sort keys
                </Toggle>
              )}
              <Toggle on={prefs.ignoreWs} onClick={() => setPref('ignoreWs', !prefs.ignoreWs)}>
                Ignore whitespace
              </Toggle>
              {info.caseOption && (
                <Toggle on={prefs.ignoreCase} onClick={() => setPref('ignoreCase', !prefs.ignoreCase)}>
                  Ignore case
                </Toggle>
              )}
              <Toggle on={prefs.collapse} onClick={() => setPref('collapse', !prefs.collapse)}>
                Collapse unchanged
              </Toggle>
              <Toggle on={prefs.wrap} onClick={() => setPref('wrap', !prefs.wrap)}>
                Wrap
              </Toggle>
              <Segmented value={prefs.view} onChange={(v) => setPref('view', v)} options={[['split', 'Split'], ['unified', 'Unified']]} />
              <IconBtn onClick={copyPatch} title="Copy diff as patch">
                <Copy size={13} />
              </IconBtn>
            </div>
          </div>

          {!result ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <p className="text-[13px] text-mutedx">
                {!left.trim() && !right.trim() ? `Paste ${label} into both editors to see the differences.` : `Add ${label} to the ${!left.trim() ? 'original' : 'modified'} side to compare.`}
              </p>
              {!left.trim() && !right.trim() && (
                <button onClick={loadSample} className="text-xs font-medium text-textx underline underline-offset-4 hover:opacity-70">
                  Try with sample data
                </button>
              )}
            </div>
          ) : changes === 0 ? (
            <p className="px-6 py-16 text-center text-[13px] font-medium text-[var(--add-text)]">✓ No differences{normalize ? ' — documents are equivalent after formatting' : ''}</p>
          ) : (
            <DiffView key={`${lang}-${prefs.view}`} rows={result.rows} lang={lang} view={prefs.view} wrap={prefs.wrap} collapse={prefs.collapse} />
          )}
        </section>

        <section className="mx-auto mt-16 max-w-3xl" aria-label="About">
          <p className="text-[13px] leading-relaxed text-mutedx">{page.intro}</p>
          <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {page.faq.map((f) => (
              <div key={f.q}>
                <h3 className="text-[13px] font-medium">{f.q}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-mutedx">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-borderx py-6 text-center text-[11px] text-mutedx">
        {LANG_ORDER.map((l) => (
          <span key={l}>
            <a href={PAGES[l].path} className="hover:text-textx">
              {LANGS[l].label} Diff
            </a>
            <span className="mx-2 text-mutedx2">·</span>
          </span>
        ))}
        Made by Rohit Rambade
      </footer>

      <div role="status" className={cn('pointer-events-none fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 truncate rounded-lg bg-textx px-4 py-2 text-xs font-medium text-bg opacity-0 shadow-lg transition-all', toast && 'opacity-100')}>
        {toast}
      </div>
    </div>
  )
}

function Btn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="flex h-8 items-center gap-1.5 rounded-lg border border-borderx bg-surface px-3 text-xs font-medium text-mutedx transition hover:border-borderx2 hover:text-textx">
      {children}
    </button>
  )
}

function IconBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} aria-label={props.title} className="flex h-7 w-7 items-center justify-center rounded-md text-mutedx transition hover:bg-surface2 hover:text-textx">
      {children}
    </button>
  )
}

function Toggle({ on, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      {...props}
      aria-pressed={on}
      className={cn(
        'h-7 rounded-md border px-2.5 text-[11px] font-medium transition disabled:opacity-40',
        on ? 'border-textx bg-textx text-bg' : 'border-borderx text-mutedx hover:border-borderx2 hover:text-textx',
      )}
    >
      {children}
    </button>
  )
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[11px] text-mutedx">{label}</span>}
      <div className="flex rounded-lg border border-borderx bg-surface p-0.5">
        {options.map(([v, text]) => (
          <button key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={cn('h-6 rounded-md px-2.5 text-[11px] font-medium text-mutedx transition hover:text-textx', value === v && 'bg-surface2 text-textx')}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Chip({ children, cls }: { children: React.ReactNode; cls: 'add' | 'del' }) {
  return <span className={cn('rounded px-1.5 py-0.5', cls === 'add' ? 'bg-[var(--add-bg)] text-[var(--add-text)]' : 'bg-[var(--del-bg)] text-[var(--del-text)]')}>{children}</span>
}
