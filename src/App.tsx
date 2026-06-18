import { useEffect, useMemo, useRef, useState } from 'react'
import { Clipboard, Copy, Download, FileUp, Moon, Sparkles, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from "@/components/ui/select"
import { cn } from '@/lib/utils'

type Mode = 'text' | 'json' | 'sql' | 'js' | 'ts' | 'py' | 'java' | 'css' | 'html' | 'yaml' | 'sh'
type ViewMode = 'split' | 'unified' | 'inline'
type DiffRow = { t: 'eq'; l: string; r: string } | { t: 'add'; r: string } | { t: 'del'; l: string } | { t: 'chg'; l: string; r: string }
type Options = { ws: boolean; case: boolean; blank: boolean; wrap: boolean }

const modes: Mode[] = ['text', 'json', 'sql', 'js', 'ts', 'py', 'java', 'css', 'html', 'yaml', 'sh']
const modeLabels: Record<Mode, string> = { text: 'Text', json: 'JSON', sql: 'SQL', js: 'JS', ts: 'TS', py: 'Python', java: 'Java', css: 'CSS', html: 'HTML', yaml: 'YAML', sh: 'Shell' }
const emptyStats = { adds: 0, dels: 0, chgs: 0, same: 0 }

function escapeHtml(input = '') {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeText(text: string, opts: Options) {
  let next = text
  if (opts.case) next = next.toLowerCase()
  if (opts.ws) next = next.replace(/[ \t]+/g, ' ').trim()
  if (opts.blank) next = next.split('\n').filter((line) => line.trim()).join('\n')
  return next
}

function lcsDiff(a: string[], b: string[]): DiffRow[] {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const raw: DiffRow[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ t: 'eq', l: a[i - 1], r: b[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ t: 'add', r: b[j - 1] })
      j--
    } else {
      raw.push({ t: 'del', l: a[i - 1] })
      i--
    }
  }

  raw.reverse()
  const merged: DiffRow[] = []
  for (let k = 0; k < raw.length; k++) {
    if (k + 1 < raw.length && raw[k].t === 'del' && raw[k + 1].t === 'add') {
      merged.push({ t: 'chg', l: (raw[k] as { l: string }).l, r: (raw[k + 1] as { r: string }).r })
      k++
    } else {
      merged.push(raw[k])
    }
  }
  return merged
}

function charDiff(left: string, right: string) {
  const a = [...left]
  const b = [...right]
  const rows = lcsDiff(a, b)
  let leftHtml = ''
  let rightHtml = ''
  rows.forEach((row) => {
    if (row.t === 'eq') {
      leftHtml += escapeHtml(row.l)
      rightHtml += escapeHtml(row.r)
    } else if (row.t === 'del') {
      leftHtml += `<mark class="ci ci-del">${escapeHtml(row.l)}</mark>`
    } else if (row.t === 'add') {
      rightHtml += `<mark class="ci ci-add">${escapeHtml(row.r)}</mark>`
    } else {
      leftHtml += `<mark class="ci ci-del">${escapeHtml(row.l)}</mark>`
      rightHtml += `<mark class="ci ci-add">${escapeHtml(row.r)}</mark>`
    }
  })
  return [leftHtml, rightHtml]
}

function contextMask(diff: DiffRow[], ctx: number) {
  if (ctx >= 9999) return diff.map(() => true)
  const mask = diff.map(() => false)
  diff.forEach((row, index) => {
    if (row.t !== 'eq') {
      for (let j = Math.max(0, index - ctx); j <= Math.min(diff.length - 1, index + ctx); j++) mask[j] = true
    }
  })
  return mask
}

function sqlFormat(value: string) {
  const keywords = ['SELECT', 'FROM', 'WHERE', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'JOIN', 'ON', 'AND', 'OR', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM']
  let result = value.trim()
  keywords.forEach((keyword) => {
    result = result.replace(new RegExp(`\\b${keyword}\\b`, 'gi'), `\n${keyword.toUpperCase()}`)
  })
  return result.replace(/^\n/, '').replace(/\n{2,}/g, '\n')
}

function lineNumbers(text: string) {
  return Array.from({ length: text.split('\n').length }, (_, index) => index + 1)
}

export default function App() {
  const [mode, setMode] = useState<Mode>('text')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [ctxLines, setCtxLines] = useState(3)
  const [opts, setOpts] = useState<Options>({ ws: false, case: false, blank: false, wrap: false })
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('diff-theme') as 'light' | 'dark') || 'light')
  const [editorHeight, setEditorHeight] = useState(() => Math.floor(window.innerHeight * 0.38))
  const [toast, setToast] = useState('')
  const [fileTarget, setFileTarget] = useState<'left' | 'right'>('left')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const leftRef = useRef<HTMLTextAreaElement>(null)
  const rightRef = useRef<HTMLTextAreaElement>(null)
  const leftGutterRef = useRef<HTMLDivElement>(null)
  const rightGutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('diff-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const diff = useMemo(() => {
    if (!left && !right) return [] as DiffRow[]
    return lcsDiff(normalizeText(left, opts).split('\n'), normalizeText(right, opts).split('\n'))
  }, [left, right, opts])

  const stats = useMemo(() => {
    if (!diff.length) return emptyStats
    return diff.reduce(
      (acc, row) => {
        if (row.t === 'add') acc.adds++
        else if (row.t === 'del') acc.dels++
        else if (row.t === 'chg') acc.chgs++
        else acc.same++
        return acc
      },
      { ...emptyStats },
    )
  }, [diff])

  const diffText = useMemo(() => diff.map((row) => (row.t === 'eq' ? ` ${row.l}` : row.t === 'del' ? `-${row.l}` : row.t === 'add' ? `+${row.r}` : `-${row.l}\n+${row.r}`)).join('\n'), [diff])

  const showToast = (message: string) => setToast(message)

  const toggleOption = (key: keyof Options) => setOpts((prev) => ({ ...prev, [key]: !prev[key] }))

  const handlePaste = async (side: 'left' | 'right') => {
    try {
      const text = await navigator.clipboard.readText()
      side === 'left' ? setLeft(text) : setRight(text)
    } catch {
      showToast('Clipboard access denied')
    }
  }

  const handleFileClick = (side: 'left' | 'right') => {
    setFileTarget(side)
    fileInputRef.current?.click()
  }

  const loadFile = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '')
      fileTarget === 'left' ? setLeft(text) : setRight(text)
      showToast(`Loaded ${file.name}`)
    }
    reader.readAsText(file)
  }

  const prettify = (side: 'left' | 'right') => {
    const value = (side === 'left' ? left : right).trim()
    if (!value) return
    try {
      const formatted = mode === 'json' ? JSON.stringify(JSON.parse(value), null, 2) : mode === 'sql' ? sqlFormat(value) : value
      side === 'left' ? setLeft(formatted) : setRight(formatted)
      showToast(mode === 'json' || mode === 'sql' ? 'Formatted' : 'Prettify available for JSON and SQL')
    } catch (error) {
      showToast(`Format error: ${(error as Error).message}`)
    }
  }

  const clearAll = () => {
    setLeft('')
    setRight('')
  }

  const copyDiff = async () => {
    if (!diffText) return showToast('Nothing to copy')
    try {
      await navigator.clipboard.writeText(diffText)
      showToast('Copied')
    } catch {
      showToast('Copy failed')
    }
  }

  const exportDiff = () => {
    if (!diffText) return showToast('Nothing to export')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([diffText], { type: 'text/plain' }))
    link.download = `diff-${Date.now()}.diff`
    link.click()
    showToast('Exported')
  }

  const startResize = (event: React.MouseEvent) => {
    const startY = event.clientY
    const startHeight = editorHeight
    document.body.style.userSelect = 'none'
    const onMove = (moveEvent: MouseEvent) => {
      setEditorHeight(Math.max(120, Math.min(window.innerHeight - 130, startHeight + (moveEvent.clientY - startY))))
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const identical = diff.length > 0 && stats.adds === 0 && stats.dels === 0 && stats.chgs === 0

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-textx transition-colors">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-borderx bg-surface px-5 transition-colors">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight"><span className="h-1.5 w-1.5 rounded-full bg-textx" />diffbit</div>
        <nav className="flex flex-1 items-center justify-center gap-1 overflow-x-auto">
          {modes.map((item) => (
            <button key={item} onClick={() => setMode(item)} className={cn('rounded-full px-3 py-1 text-xs font-medium text-mutedx transition hover:bg-surface2 hover:text-textx', mode === item && 'bg-textx text-bg hover:bg-textx hover:text-bg')}>{modeLabels[item]}</button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-mutedx">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          <Button variant="outline" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}</Button>
          <Button variant="outline" onClick={clearAll}>Clear</Button>
          <Button variant="default">Compare</Button>
        </div>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-b border-borderx bg-surface px-5 transition-colors">
        <span className="text-[11px] font-medium text-mutedx">View</span>
        <Select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}><option value="split">Split</option><option value="unified">Unified</option><option value="inline">Inline</option></Select>
        <Separator />
        <span className="text-[11px] font-medium text-mutedx">Context</span>
        <Select value={ctxLines} onChange={(e) => setCtxLines(Number(e.target.value))}><option value="3">3 lines</option><option value="5">5 lines</option><option value="10">10 lines</option><option value="9999">Full file</option></Select>
        <Separator />
        <ToolbarToggle active={opts.ws} onClick={() => toggleOption('ws')}>Ignore whitespace</ToolbarToggle>
        <ToolbarToggle active={opts.case} onClick={() => toggleOption('case')}>Ignore case</ToolbarToggle>
        <ToolbarToggle active={opts.blank} onClick={() => toggleOption('blank')}>Ignore blank lines</ToolbarToggle>
        <ToolbarToggle active={opts.wrap} onClick={() => toggleOption('wrap')}>Wrap</ToolbarToggle>
        <Separator className="ml-auto" />
        <Button variant="outline" onClick={exportDiff}><Download size={13} /> Export .diff</Button>
        <Button variant="outline" onClick={copyDiff}><Copy size={13} /> Copy diff</Button>
      </div>

      <section className="grid shrink-0 grid-cols-2 border-b border-borderx" style={{ height: editorHeight }}>
        <EditorPane label="Original" value={left} setValue={setLeft} side="left" bodyHeight={editorHeight - 34} onPaste={handlePaste} onFile={handleFileClick} onPrettify={prettify} textareaRef={leftRef} gutterRef={leftGutterRef} />
        <EditorPane label="Modified" value={right} setValue={setRight} side="right" bodyHeight={editorHeight - 34} onPaste={handlePaste} onFile={handleFileClick} onPrettify={prettify} textareaRef={rightRef} gutterRef={rightGutterRef} />
      </section>
      <div className="h-1 shrink-0 cursor-ns-resize border-y border-borderx hover:bg-borderx2" onMouseDown={startResize} />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-borderx bg-surface px-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-mutedx">Result</span>
          <div className="flex gap-1.5"><Stat type="add">+{stats.adds}</Stat><Stat type="del">-{stats.dels}</Stat><Stat>{stats.same} same</Stat></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          {!left && !right ? <Empty /> : identical ? <div className="flex items-center justify-center gap-2 p-6 text-sm font-medium text-[var(--add-text)]">✓ Files are identical</div> : <DiffView diff={diff} ctx={ctxLines} wrap={opts.wrap} view={viewMode} leftRaw={left} rightRaw={right} />}
        </div>
      </main>
      <footer className="flex h-8 shrink-0 items-center justify-center border-t border-borderx bg-surface text-[11px] tracking-wide text-mutedx2">Made with ❤️ by <span className="text-mutedx">&nbsp;Rohit Rambade</span></footer>
      <input ref={fileInputRef} type="file" hidden onChange={(event) => { loadFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
      <div className={cn('pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 translate-y-12 rounded-lg bg-textx px-5 py-2 text-xs font-medium text-bg transition-transform', toast && 'translate-y-0')}>{toast}</div>
    </div>
  )
}

function Separator({ className }: { className?: string }) { return <div className={cn('h-5 w-px shrink-0 bg-borderx', className)} /> }
function ToolbarToggle({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) { return <button onClick={onClick} className={cn('whitespace-nowrap rounded-md border border-borderx px-3 py-1 text-xs font-medium text-mutedx transition hover:border-borderx2 hover:text-textx', active && 'border-textx bg-textx text-bg hover:text-bg')}>{children}</button> }
function Stat({ children, type }: { children: React.ReactNode; type?: 'add' | 'del' }) { return <span className={cn('rounded border border-borderx bg-surface2 px-2 py-0.5 text-[11px] font-medium text-mutedx', type === 'add' && 'border-[var(--add-hi)] bg-[var(--add-bg)] text-[var(--add-text)]', type === 'del' && 'border-[var(--del-hi)] bg-[var(--del-bg)] text-[var(--del-text)]')}>{children}</span> }
function Empty() { return <div className="flex h-full flex-col items-center justify-center gap-2 text-mutedx2"><p className="text-sm">Paste content in both panels and click Compare</p></div> }

function EditorPane(props: { label: string; value: string; setValue: (v: string) => void; side: 'left' | 'right'; bodyHeight: number; onPaste: (s: 'left' | 'right') => void; onFile: (s: 'left' | 'right') => void; onPrettify: (s: 'left' | 'right') => void; textareaRef: React.RefObject<HTMLTextAreaElement | null>; gutterRef: React.RefObject<HTMLDivElement | null> }) {
  const numbers = lineNumbers(props.value)
  return <div className="flex min-w-0 flex-col border-r border-borderx last:border-r-0"><div className="flex h-[34px] shrink-0 items-center justify-between border-b border-borderx bg-surface2"><span className="px-3.5 text-[11px] font-semibold uppercase tracking-wide text-mutedx">{props.label}</span><div className="flex gap-1 pr-2"><IconButton title="Paste" onClick={() => props.onPaste(props.side)}><Clipboard size={13} /></IconButton><IconButton title="Upload file" onClick={() => props.onFile(props.side)}><FileUp size={13} /></IconButton><IconButton title="Prettify" onClick={() => props.onPrettify(props.side)}><Sparkles size={13} /></IconButton><IconButton title="Clear" onClick={() => props.setValue('')}><X size={13} /></IconButton></div></div><div className="relative overflow-hidden" style={{ height: props.bodyHeight }}><div ref={props.gutterRef} className="absolute bottom-0 left-0 top-0 w-10 overflow-hidden border-r border-borderx bg-surface2 py-2.5 text-right font-mono text-[11px] leading-5 text-mutedx2">{numbers.map((n) => <span key={n} className="block pr-2">{n}</span>)}</div><textarea ref={props.textareaRef} value={props.value} onChange={(e) => props.setValue(e.target.value)} onScroll={(e) => { if (props.gutterRef.current) props.gutterRef.current.scrollTop = e.currentTarget.scrollTop }} onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; props.setValue(props.value.slice(0, start) + '  ' + props.value.slice(end)); requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 }) } }} spellCheck={false} placeholder={`Paste ${props.label.toLowerCase()} content…`} className="absolute inset-0 left-10 resize-none overflow-auto border-0 bg-surface px-3.5 py-2.5 font-mono text-[13px] leading-5 text-textx outline-none placeholder:text-mutedx2" /></div></div>
}
function IconButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className="flex h-6 w-6 items-center justify-center rounded border-0 bg-transparent text-mutedx2 transition hover:bg-borderx hover:text-textx">{children}</button> }

function DiffView({ diff, ctx, wrap, view, leftRaw, rightRaw }: { diff: DiffRow[]; ctx: number; wrap: boolean; view: ViewMode; leftRaw: string; rightRaw: string }) {
  if (view === 'inline') return <InlineDiff left={leftRaw} right={rightRaw} wrap={wrap} />
  if (view === 'unified') return <UnifiedDiff diff={diff} ctx={ctx} wrap={wrap} />
  return <SplitDiff diff={diff} ctx={ctx} wrap={wrap} />
}

function UnifiedDiff({ diff, ctx, wrap }: { diff: DiffRow[]; ctx: number; wrap: boolean }) {
  const mask = contextMask(diff, ctx)
  let leftNo = 1, rightNo = 1, skipped = false
  const rows: React.ReactNode[] = []
  diff.forEach((row, index) => {
    if (!mask[index]) { if (!skipped) rows.push(<tr key={`skip-${index}`} className="row-hunk"><td colSpan={4}>@@ skipping unchanged lines @@</td></tr>); skipped = true; if (row.t === 'eq' || row.t === 'chg') { leftNo++; rightNo++ } else if (row.t === 'del') leftNo++; else rightNo++; return }
    skipped = false
    if (row.t === 'eq') { rows.push(<tr key={index}><td className="d-gutter">{leftNo}</td><td className="d-gutter">{rightNo}</td><td className="d-sign" /><td className={cn('d-code', wrap ? 'wrap' : 'nowrap')}>{row.l}</td></tr>); leftNo++; rightNo++ }
    else if (row.t === 'del') { rows.push(<tr key={index} className="row-del"><td className="d-gutter">{leftNo}</td><td className="d-gutter" /><td className="d-sign">−</td><td className={cn('d-code', wrap ? 'wrap' : 'nowrap')}>{row.l}</td></tr>); leftNo++ }
    else if (row.t === 'add') { rows.push(<tr key={index} className="row-add"><td className="d-gutter" /><td className="d-gutter">{rightNo}</td><td className="d-sign">+</td><td className={cn('d-code', wrap ? 'wrap' : 'nowrap')}>{row.r}</td></tr>); rightNo++ }
    else { const [lh, rh] = charDiff(row.l, row.r); rows.push(<tr key={`${index}-d`} className="row-del"><td className="d-gutter">{leftNo}</td><td className="d-gutter" /><td className="d-sign">−</td><td className={cn('d-code', wrap ? 'wrap' : 'nowrap')} dangerouslySetInnerHTML={{ __html: lh }} /></tr>, <tr key={`${index}-a`} className="row-add"><td className="d-gutter" /><td className="d-gutter">{rightNo}</td><td className="d-sign">+</td><td className={cn('d-code', wrap ? 'wrap' : 'nowrap')} dangerouslySetInnerHTML={{ __html: rh }} /></tr>); leftNo++; rightNo++ }
  })
  return <table className="diff-table"><tbody>{rows}</tbody></table>
}

function SplitDiff({ diff, ctx, wrap }: { diff: DiffRow[]; ctx: number; wrap: boolean }) {
  const mask = contextMask(diff, ctx)
  let leftNo = 1, rightNo = 1, skipped = false
  const leftRows: React.ReactNode[] = [], rightRows: React.ReactNode[] = []
  diff.forEach((row, index) => {
    if (!mask[index]) { if (!skipped) { leftRows.push(<div key={`ls-${index}`} className="s-hunk">@@ skipped @@</div>); rightRows.push(<div key={`rs-${index}`} className="s-hunk">@@ skipped @@</div>) } skipped = true; if (row.t === 'eq' || row.t === 'chg') { leftNo++; rightNo++ } else if (row.t === 'del') leftNo++; else rightNo++; return }
    skipped = false
    if (row.t === 'eq') { leftRows.push(<SplitRow key={`l-${index}`} no={leftNo} text={row.l} wrap={wrap} />); rightRows.push(<SplitRow key={`r-${index}`} no={rightNo} text={row.r} wrap={wrap} />); leftNo++; rightNo++ }
    else if (row.t === 'del') { leftRows.push(<SplitRow key={`l-${index}`} no={leftNo} text={row.l} wrap={wrap} type="del" />); rightRows.push(<SplitRow key={`r-${index}`} wrap={wrap} empty />); leftNo++ }
    else if (row.t === 'add') { leftRows.push(<SplitRow key={`l-${index}`} wrap={wrap} empty />); rightRows.push(<SplitRow key={`r-${index}`} no={rightNo} text={row.r} wrap={wrap} type="add" />); rightNo++ }
    else { const [lh, rh] = charDiff(row.l, row.r); leftRows.push(<SplitRow key={`l-${index}`} no={leftNo} html={lh} wrap={wrap} type="del" />); rightRows.push(<SplitRow key={`r-${index}`} no={rightNo} html={rh} wrap={wrap} type="add" />); leftNo++; rightNo++ }
  })
  return <div className="grid h-full grid-cols-2"><div className="overflow-auto border-r border-borderx font-mono text-[12.5px] leading-5">{leftRows}</div><div className="overflow-auto font-mono text-[12.5px] leading-5">{rightRows}</div></div>
}

function SplitRow({ no, text = ' ', html, wrap, type, empty }: { no?: number; text?: string; html?: string; wrap: boolean; type?: 'add' | 'del'; empty?: boolean }) { return <div className={cn('flex min-w-0', type === 'add' && 's-add', type === 'del' && 's-del', empty && 's-empty')}><div className="s-gutter">{no}</div><div className={cn('s-code', wrap && 'wrap')} {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : text}</div></div> }

function InlineDiff({ left, right, wrap }: { left: string; right: string; wrap: boolean }) {
  const [lh, rh] = charDiff(left, right)
  const html = `${lh}<br/><br/>${rh}`
  return <div className="inline-wrap" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }} dangerouslySetInnerHTML={{ __html: html }} />
}
