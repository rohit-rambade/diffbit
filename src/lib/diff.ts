import type { Token } from './types'

export type Op = 'eq' | 'del' | 'add'

/** Myers O(ND) diff over arrays of comparable ids. Returns an edit script. */
export function myers(a: ArrayLike<number>, b: ArrayLike<number>): Op[] {
  // Trim common prefix / suffix — the common case for diffs is a small change in a big file.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  const middle: Op[] = []

  if (n === 0) for (let k = 0; k < m; k++) middle.push('add')
  else if (m === 0) for (let k = 0; k < n; k++) middle.push('del')
  else {
    const max = n + m
    const off = max + 1
    const v = new Int32Array(2 * max + 3)
    const trace: Int32Array[] = []
    let found = false
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice(off - d, off + d + 1))
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
        let y = x - k
        while (x < n && y < m && a[start + x] === b[start + y]) {
          x++
          y++
        }
        v[off + k] = x
        if (x >= n && y >= m) {
          found = true
          break
        }
      }
    }
    // Backtrack
    let x = n
    let y = m
    for (let d = trace.length - 1; d >= 0; d--) {
      const vd = trace[d] // values of V at the *start* of step d, indexed k + d
      const k = x - y
      const get = (kk: number) => vd[kk + d]
      let prevK: number
      if (d === 0) prevK = 0
      else prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1
      const prevX = d === 0 ? 0 : get(prevK)
      const prevY = prevX - prevK
      while (x > prevX && y > prevY) {
        middle.push('eq')
        x--
        y--
      }
      if (d > 0) middle.push(prevK === k + 1 ? 'add' : 'del')
      x = prevX
      y = prevY
    }
    middle.reverse()
  }

  const ops: Op[] = new Array(start).fill('eq')
  for (const op of middle) ops.push(op)
  for (let k = endA; k < a.length; k++) ops.push('eq')
  return ops
}

function toIds(aList: string[], bList: string[], key: (s: string) => string) {
  const map = new Map<string, number>()
  const id = (s: string) => {
    const k = key(s)
    let v = map.get(k)
    if (v === undefined) map.set(k, (v = map.size))
    return v
  }
  return [Int32Array.from(aList, id), Int32Array.from(bList, id)] as const
}

export type Row =
  | { t: 'eq'; l: string; r: string; ln: number; rn: number }
  | { t: 'del'; l: string; ln: number }
  | { t: 'add'; r: string; rn: number }
  | { t: 'chg'; l: string; r: string; ln: number; rn: number }

export type DiffResult = { rows: Row[]; adds: number; dels: number; chgs: number }

/** Line diff. Runs of deletions followed by additions are paired up as "changed" lines. */
export function diffLines(left: string, right: string, ignoreWhitespace = false, ignoreCase = false): DiffResult {
  const a = left.split('\n')
  const b = right.split('\n')
  const key = (s: string) => {
    const k = ignoreWhitespace ? s.replace(/\s+/g, '') : s
    return ignoreCase ? k.toLowerCase() : k
  }
  const [ia, ib] = toIds(a, b, key)
  const ops = myers(ia, ib)
  const rows: Row[] = []
  let i = 0
  let j = 0
  let adds = 0
  let dels = 0
  let chgs = 0
  for (let k = 0; k < ops.length; ) {
    if (ops[k] === 'eq') {
      rows.push({ t: 'eq', l: a[i], r: b[j], ln: ++i, rn: ++j })
      k++
      continue
    }
    const delStart = i
    const addStart = j
    while (k < ops.length && ops[k] !== 'eq') {
      if (ops[k] === 'del') i++
      else j++
      k++
    }
    for (const op of alignBlock(a.slice(delStart, i), b.slice(addStart, j), key)) {
      if (op.t === 'chg') {
        rows.push({ t: 'chg', l: a[delStart + op.i], r: b[addStart + op.j], ln: delStart + op.i + 1, rn: addStart + op.j + 1 })
        chgs++
      } else if (op.t === 'del') {
        rows.push({ t: 'del', l: a[delStart + op.i], ln: delStart + op.i + 1 })
        dels++
      } else {
        rows.push({ t: 'add', r: b[addStart + op.j], rn: addStart + op.j + 1 })
        adds++
      }
    }
  }
  return { rows, adds, dels, chgs }
}

type BlockOp = { t: 'chg'; i: number; j: number } | { t: 'del'; i: number } | { t: 'add'; j: number }

const WORD_RE = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu

/** Dice similarity of two lines' word multisets (0..1). */
function similarity(x: string[], y: string[]) {
  if (!x.length && !y.length) return 1
  if (!x.length || !y.length) return 0
  const counts = new Map<string, number>()
  for (const w of x) counts.set(w, (counts.get(w) ?? 0) + 1)
  let common = 0
  for (const w of y) {
    const c = counts.get(w)
    if (c) {
      common++
      counts.set(w, c - 1)
    }
  }
  return (2 * common) / (x.length + y.length)
}

const MIN_SIMILARITY = 0.4

/**
 * Pairs deleted and added lines inside one change block by similarity, so a
 * modified line is compared with its real counterpart even when lines were
 * inserted or removed around it. Order is preserved on both sides.
 */
function alignBlock(dels: string[], adds: string[], key: (s: string) => string): BlockOp[] {
  const nd = dels.length
  const na = adds.length
  const out: BlockOp[] = []
  if (!nd || !na || nd * na > 40_000) {
    // Nothing to pair, or too large to align cheaply: pair by position.
    const paired = Math.min(nd, na)
    for (let p = 0; p < paired; p++) out.push({ t: 'chg', i: p, j: p })
    for (let p = paired; p < nd; p++) out.push({ t: 'del', i: p })
    for (let p = paired; p < na; p++) out.push({ t: 'add', j: p })
    return out
  }
  const words = (s: string) => key(s).match(WORD_RE) ?? []
  const dw = dels.map(words)
  const aw = adds.map(words)
  // score[x][y]: best total similarity aligning dels[0..x) with adds[0..y)
  const w = na + 1
  const score = new Float64Array((nd + 1) * w)
  const sim = new Float64Array(nd * na)
  for (let x = 1; x <= nd; x++) {
    for (let y = 1; y <= na; y++) {
      const s = similarity(dw[x - 1], aw[y - 1])
      sim[(x - 1) * na + (y - 1)] = s
      const pair = s >= MIN_SIMILARITY ? score[(x - 1) * w + (y - 1)] + s : -1
      score[x * w + y] = Math.max(score[(x - 1) * w + y], score[x * w + (y - 1)], pair)
    }
  }
  let x = nd
  let y = na
  while (x > 0 || y > 0) {
    if (x > 0 && y > 0) {
      const s = sim[(x - 1) * na + (y - 1)]
      if (s >= MIN_SIMILARITY && score[x * w + y] === score[(x - 1) * w + (y - 1)] + s) {
        out.push({ t: 'chg', i: --x, j: --y })
        continue
      }
    }
    // Emit additions after deletions at the same position (reads naturally: - then +).
    if (y > 0 && (x === 0 || score[x * w + (y - 1)] >= score[(x - 1) * w + y])) out.push({ t: 'add', j: --y })
    else out.push({ t: 'del', i: --x })
  }
  return out.reverse()
}

/** Split syntax tokens into word-level pieces so intra-line highlights are precise. */
function explode(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const t of tokens) {
    const parts = t.text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []
    for (const p of parts) out.push({ text: p, cls: t.cls })
  }
  return out
}

/** Word-level diff between two tokenized lines; marks the pieces that differ. */
export function intraLine(left: Token[], right: Token[]): [Token[], Token[]] {
  const l = explode(left)
  const r = explode(right)
  if (l.length * r.length > 250_000) return [left.map((t) => ({ ...t, mark: true })), right.map((t) => ({ ...t, mark: true }))]
  const [il, ir] = toIds(
    l.map((t) => t.text),
    r.map((t) => t.text),
    (s) => s,
  )
  const ops = myers(il, ir)
  const outL: Token[] = []
  const outR: Token[] = []
  let i = 0
  let j = 0
  for (const op of ops) {
    if (op === 'eq') {
      outL.push(l[i++])
      outR.push(r[j++])
    } else if (op === 'del') outL.push({ ...l[i++], mark: true })
    else outR.push({ ...r[j++], mark: true })
  }
  return [outL, outR]
}

export function toPatch(result: DiffResult) {
  return result.rows
    .map((row) => {
      if (row.t === 'eq') return ` ${row.l}`
      if (row.t === 'del') return `-${row.l}`
      if (row.t === 'add') return `+${row.r}`
      return `-${row.l}\n+${row.r}`
    })
    .join('\n')
}
