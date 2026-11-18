import { memo, useMemo, useRef, useState } from 'react'
import { AlignLeft, Check, Copy, FileUp, Minimize2, X } from 'lucide-react'
import { tokenize } from '@/lib/highlight'
import type { Lang, ValidationError } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Tokens } from './Tokens'

const HIGHLIGHT_LIMIT = 400_000

type Props = {
  lang: Lang
  label: string
  value: string
  onChange: (value: string) => void
  error: ValidationError | null
  onFormat: () => void
  onMinify: () => void
  /** Returns formatted text for a paste into an empty editor, or null to paste as-is. */
  formatOnPaste: (text: string) => string | null
  onNotify: (msg: string) => void
}

export function CodeEditor({ lang, label, value, onChange, error, onFormat, onMinify, formatOnPaste, onNotify }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const lineCount = useMemo(() => {
    let n = 1
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) n++
    return n
  }, [value])
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount])
  const highlight = value.length <= HIGHLIGHT_LIMIT

  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (layerRef.current) layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`
  }

  const readFile = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      onChange(formatOnPaste(text) ?? text)
      onNotify(`Loaded ${file.name}`)
    }
    reader.readAsText(file)
  }

  const jumpTo = (line: number, col: number) => {
    const ta = taRef.current
    if (!ta) return
    const lines = value.split('\n')
    let pos = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1
    pos += Math.max(0, col - 1)
    ta.focus()
    ta.setSelectionRange(pos, pos + 1)
    ta.scrollTop = Math.max(0, (line - 4) * 20)
  }

  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      onNotify('Copied to clipboard')
    } catch {
      onNotify('Copy failed')
    }
  }

  const status = !value.trim() ? null : error ? (
    <button onClick={() => jumpTo(error.line, error.col)} className="truncate text-left text-[var(--del-text)] hover:underline" title={error.message}>
      Ln {error.line}, Col {error.col} · {error.message}
    </button>
  ) : (
    <span className="flex items-center gap-1 text-[var(--add-text)]">
      <Check size={12} /> Valid {lang.toUpperCase()}
    </span>
  )

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-borderx bg-surface">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-borderx pl-3.5 pr-1.5">
        <span className="text-xs font-medium text-textx">{label}</span>
        <div className="flex items-center">
          <ToolButton onClick={onFormat} title="Beautify (Shift+Alt+F)">
            <AlignLeft size={13} />
            <span className="hidden sm:inline">Format</span>
          </ToolButton>
          <ToolButton onClick={onMinify} title="Minify">
            <Minimize2 size={13} />
          </ToolButton>
          <ToolButton onClick={copy} title="Copy">
            <Copy size={13} />
          </ToolButton>
          <ToolButton onClick={() => fileRef.current?.click()} title="Open file">
            <FileUp size={13} />
          </ToolButton>
          <ToolButton onClick={() => onChange('')} title="Clear">
            <X size={13} />
          </ToolButton>
        </div>
      </div>

      <div
        className={cn('editor relative min-h-0 flex-1 overflow-hidden', dragging && 'ring-2 ring-inset ring-borderx2')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          readFile(e.dataTransfer.files?.[0])
        }}
      >
        <div className="absolute inset-y-0 left-0 w-11 overflow-hidden border-r border-borderx bg-surface2">
          <pre ref={gutterRef} className="editor-text m-0 pr-2.5 text-right text-mutedx2">
            {numbers}
          </pre>
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-11 right-0 overflow-hidden" aria-hidden>
          {highlight && <HighlightLayer layerRef={layerRef} lang={lang} value={value} errorLine={error?.line} />}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onPaste={(e) => {
            const ta = e.currentTarget
            const replacingAll = !value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === value.length)
            if (!replacingAll) return
            const formatted = formatOnPaste(e.clipboardData.getData('text'))
            if (formatted === null) return
            e.preventDefault()
            onChange(formatted)
            requestAnimationFrame(() => {
              ta.scrollTop = 0
              syncScroll()
            })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              document.execCommand('insertText', false, '  ')
            } else if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
              e.preventDefault()
              onFormat()
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          aria-label={`${label} ${lang.toUpperCase()}`}
          placeholder={`Paste or drop ${lang.toUpperCase()} here…`}
          className={cn(
            'editor-text absolute inset-y-0 left-11 right-0 h-full w-[calc(100%-2.75rem)] resize-none overflow-auto border-0 bg-transparent outline-none placeholder:font-sans placeholder:text-mutedx2',
            highlight ? 'text-transparent caret-[var(--text)] selection:bg-[var(--sel)]' : 'text-textx',
          )}
        />
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-borderx px-3.5 text-[11px] text-mutedx">
        <div className="min-w-0 flex-1 truncate">{status}</div>
        <span className="shrink-0 tabular-nums">
          {lineCount.toLocaleString()} lines · {formatBytes(new Blob([value]).size)}
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={lang === 'json' ? '.json,application/json,text/plain' : '.xml,.xsd,.xsl,.svg,.config,text/xml,application/xml,text/plain'}
        onChange={(e) => {
          readFile(e.target.files?.[0])
          e.currentTarget.value = ''
        }}
      />
    </div>
  )
}

const HighlightLayer = memo(function HighlightLayer({ layerRef, lang, value, errorLine }: { layerRef: React.RefObject<HTMLDivElement | null>; lang: Lang; value: string; errorLine?: number }) {
  const lines = useMemo(() => value.split('\n').map((l) => tokenize(lang, l)), [lang, value])
  return (
    <div ref={layerRef} className="editor-text w-max min-w-full">
      {lines.map((tokens, i) => (
        <div key={i} className={cn('h-5', errorLine === i + 1 && 'bg-[var(--del-bg)]')}>
          <Tokens tokens={tokens} />
        </div>
      ))}
    </div>
  )
})

function ToolButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-mutedx transition hover:bg-surface2 hover:text-textx">
      {children}
    </button>
  )
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
