import { useMemo, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { intraLine, type Row } from '@/lib/diff'
import { tokenize } from '@/lib/highlight'
import type { Lang, Token } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Tokens } from './Tokens'

export type ViewMode = 'split' | 'unified'

const CONTEXT = 3
const PAGE = 2000

type Item = { k: 'row'; i: number } | { k: 'gap'; from: number; to: number }

export function DiffView({ rows, lang, view, wrap, collapse }: { rows: Row[]; lang: Lang; view: ViewMode; wrap: boolean; collapse: boolean }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [limit, setLimit] = useState(PAGE)

  const items = useMemo(() => {
    const out: Item[] = []
    if (!collapse) {
      for (let i = 0; i < rows.length; i++) out.push({ k: 'row', i })
      return out
    }
    const keep = new Uint8Array(rows.length)
    rows.forEach((r, i) => {
      if (r.t !== 'eq') for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) keep[j] = 1
    })
    for (let i = 0; i < rows.length; ) {
      if (keep[i]) {
        out.push({ k: 'row', i: i++ })
        continue
      }
      const from = i
      while (i < rows.length && !keep[i]) i++
      if (expanded.has(from) || i - from <= 2) for (let j = from; j < i; j++) out.push({ k: 'row', i: j })
      else out.push({ k: 'gap', from, to: i })
    }
    return out
  }, [rows, collapse, expanded])

  const visible = items.slice(0, limit)
  const expand = (from: number) => setExpanded((s) => new Set(s).add(from))

  return (
    <div className="overflow-x-auto">
      <table className={cn('diff-table', view, wrap ? 'wrap' : 'nowrap')}>
        {view === 'split' ? (
          <colgroup>
            <col className="w-12" />
            <col />
            <col className="w-12" />
            <col />
          </colgroup>
        ) : (
          <colgroup>
            <col className="w-12" />
            <col className="w-12" />
            <col className="w-6" />
            <col />
          </colgroup>
        )}
        <tbody>
          {visible.map((item) =>
            item.k === 'gap' ? (
              <tr key={`g${item.from}`} className="row-gap">
                <td colSpan={4}>
                  <button onClick={() => expand(item.from)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-mutedx hover:text-textx">
                    <ChevronsUpDown size={12} /> {item.to - item.from} unchanged lines
                  </button>
                </td>
              </tr>
            ) : view === 'split' ? (
              <SplitRow key={item.i} index={item.i} row={rows[item.i]} prev={rows[item.i - 1]} lang={lang} />
            ) : (
              <UnifiedRows key={item.i} index={item.i} row={rows[item.i]} prev={rows[item.i - 1]} lang={lang} />
            ),
          )}
        </tbody>
      </table>
      {items.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="w-full border-t border-borderx py-2.5 text-xs text-mutedx hover:bg-surface2 hover:text-textx">
          Show more ({(items.length - limit).toLocaleString()} remaining)
        </button>
      )}
    </div>
  )
}

/** First row of each contiguous change block gets an anchor for prev/next navigation. */
const anchor = (row: Row, prev: Row | undefined) => (row.t !== 'eq' && (!prev || prev.t === 'eq') ? { 'data-change': '' } : {})

function lineTokens(lang: Lang, row: Row): [Token[], Token[]] {
  if (row.t === 'chg') return intraLine(tokenize(lang, row.l), tokenize(lang, row.r))
  return [row.t === 'add' ? [] : tokenize(lang, row.l), row.t === 'del' ? [] : tokenize(lang, row.r)]
}

function SplitRow({ row, prev, lang, index }: { row: Row; prev?: Row; lang: Lang; index: number }) {
  const [l, r] = lineTokens(lang, row)
  const leftCls = row.t === 'del' || row.t === 'chg' ? 'del' : row.t === 'add' ? 'empty' : ''
  const rightCls = row.t === 'add' || row.t === 'chg' ? 'add' : row.t === 'del' ? 'empty' : ''
  return (
    <tr data-row={index} {...anchor(row, prev)}>
      <td className={cn('ln', leftCls)}>{row.t !== 'add' ? row.ln : ''}</td>
      <td className={cn('code', leftCls)}>{row.t !== 'add' && <Tokens tokens={l} />}</td>
      <td className={cn('ln sep', rightCls)}>{row.t !== 'del' ? row.rn : ''}</td>
      <td className={cn('code', rightCls)}>{row.t !== 'del' && <Tokens tokens={r} />}</td>
    </tr>
  )
}

function UnifiedRows({ row, prev, lang, index }: { row: Row; prev?: Row; lang: Lang; index: number }) {
  const [l, r] = lineTokens(lang, row)
  const del = (
    <tr key="d" data-row={index} className="del" {...anchor(row, prev)}>
      <td className="ln">{row.t !== 'add' ? row.ln : ''}</td>
      <td className="ln" />
      <td className="sign">−</td>
      <td className="code">
        <Tokens tokens={l} />
      </td>
    </tr>
  )
  const add = (
    <tr key="a" data-row={index} className="add" {...(row.t === 'add' ? anchor(row, prev) : {})}>
      <td className="ln" />
      <td className="ln">{row.t !== 'del' ? row.rn : ''}</td>
      <td className="sign">+</td>
      <td className="code">
        <Tokens tokens={r} />
      </td>
    </tr>
  )
  if (row.t === 'del') return del
  if (row.t === 'add') return add
  if (row.t === 'chg')
    return (
      <>
        {del}
        {add}
      </>
    )
  return (
    <tr data-row={index}>
      <td className="ln">{row.ln}</td>
      <td className="ln">{row.rn}</td>
      <td className="sign" />
      <td className="code">
        <Tokens tokens={l} />
      </td>
    </tr>
  )
}
