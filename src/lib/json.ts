import type { FormatResult, Token, ValidationError } from './types'

type Node =
  | { t: 'obj'; entries: [string, Node][] }
  | { t: 'arr'; items: Node[] }
  | { t: 'lit'; raw: string }

class ParseError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

export function posToLineCol(text: string, pos: number) {
  let line = 1
  let col = 1
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      col = 1
    } else col++
  }
  return { line, col }
}

/** Strict JSON parser that keeps raw number text and key order. */
function parse(src: string): Node {
  let i = 0
  const ws = () => {
    while (i < src.length) {
      const c = src.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const describe = () => (i >= src.length ? 'end of input' : `'${src[i]}'`)

  const str = (): string => {
    const start = i
    i++
    while (i < src.length) {
      const c = src[i]
      if (c === '"') {
        i++
        return src.slice(start, i)
      }
      if (c === '\\') {
        const n = src[i + 1]
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) throw new ParseError('Invalid unicode escape', i)
          i += 6
        } else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2
        else throw new ParseError('Invalid escape sequence', i)
        continue
      }
      if (c === '\n') throw new ParseError('Unterminated string', start)
      i++
    }
    throw new ParseError('Unterminated string', start)
  }

  const value = (): Node => {
    ws()
    const c = src[i]
    if (c === '{') {
      i++
      const entries: [string, Node][] = []
      ws()
      if (src[i] === '}') {
        i++
        return { t: 'obj', entries }
      }
      for (;;) {
        ws()
        if (src[i] !== '"') throw new ParseError(`Expected property name, found ${describe()}`, i)
        const key = str()
        ws()
        if (src[i] !== ':') throw new ParseError(`Expected ':' after property name, found ${describe()}`, i)
        i++
        entries.push([key, value()])
        ws()
        if (src[i] === ',') {
          i++
          ws()
          if (src[i] === '}') throw new ParseError('Trailing comma is not allowed', i - 1)
          continue
        }
        if (src[i] === '}') {
          i++
          return { t: 'obj', entries }
        }
        throw new ParseError(`Expected ',' or '}', found ${describe()}`, i)
      }
    }
    if (c === '[') {
      i++
      const items: Node[] = []
      ws()
      if (src[i] === ']') {
        i++
        return { t: 'arr', items }
      }
      for (;;) {
        items.push(value())
        ws()
        if (src[i] === ',') {
          i++
          ws()
          if (src[i] === ']') throw new ParseError('Trailing comma is not allowed', i - 1)
          continue
        }
        if (src[i] === ']') {
          i++
          return { t: 'arr', items }
        }
        throw new ParseError(`Expected ',' or ']', found ${describe()}`, i)
      }
    }
    if (c === '"') return { t: 'lit', raw: str() }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 400))
    if (m) {
      i += m[0].length
      return { t: 'lit', raw: m[0] }
    }
    for (const kw of ['true', 'false', 'null']) {
      if (src.startsWith(kw, i)) {
        i += kw.length
        return { t: 'lit', raw: kw }
      }
    }
    throw new ParseError(`Unexpected ${describe()}`, i)
  }

  const root = value()
  ws()
  if (i < src.length) throw new ParseError(`Unexpected ${describe()} after JSON value`, i)
  return root
}

function print(node: Node, indent: string, sortKeys: boolean, depth = 0): string {
  if (node.t === 'lit') return node.raw
  const nl = indent ? '\n' : ''
  const pad = indent.repeat(depth + 1)
  const close = indent.repeat(depth)
  const sep = indent ? ': ' : ':'
  if (node.t === 'arr') {
    if (!node.items.length) return '[]'
    return `[${nl}${node.items.map((n) => pad + print(n, indent, sortKeys, depth + 1)).join(`,${nl}`)}${nl}${close}]`
  }
  if (!node.entries.length) return '{}'
  const entries = sortKeys ? [...node.entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : node.entries
  return `{${nl}${entries.map(([k, v]) => pad + k + sep + print(v, indent, sortKeys, depth + 1)).join(`,${nl}`)}${nl}${close}}`
}

/** Best-effort formatter for input that is not valid JSON (trailing commas, comments, truncated payloads…). */
function looseFormat(src: string, indent: string): string {
  const re = /"(?:[^"\\\n]|\\.)*"?|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[{}[\],:]|[^\s{}[\],:"]+/g
  let out = ''
  let depth = 0
  let lineStart = true
  const newline = () => {
    out = out.replace(/[ \t]+$/, '') + '\n' + indent.repeat(Math.max(0, depth))
    lineStart = true
  }
  const tokens = src.match(re) ?? []
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k]
    const next = tokens[k + 1]
    if (tok === '{' || tok === '[') {
      const closer = tok === '{' ? '}' : ']'
      if (next === closer) {
        out += tok + closer
        k++
        lineStart = false
        continue
      }
      out += tok
      depth++
      newline()
    } else if (tok === '}' || tok === ']') {
      depth--
      if (!lineStart) newline()
      else out = out.replace(/[ \t]*$/, indent.repeat(Math.max(0, depth)))
      out += tok
      lineStart = false
    } else if (tok === ',') {
      out += ','
      newline()
    } else if (tok === ':') {
      out += ': '
    } else if (tok.startsWith('//') || tok.startsWith('/*')) {
      if (!lineStart) out += ' '
      out += tok
      newline()
    } else {
      out += tok
      lineStart = false
    }
  }
  return out.replace(/\s+$/, '')
}

export function validateJson(text: string): ValidationError | null {
  const src = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (!src.trim()) return null
  try {
    parse(src)
    return null
  } catch (e) {
    const err = e as ParseError
    return { message: err.message, ...posToLineCol(src, err.pos) }
  }
}

export function formatJson(text: string, indent: string, sortKeys = false): FormatResult {
  const src = text.trim()
  if (!src) return { output: '', error: null }
  try {
    return { output: print(parse(src), indent, sortKeys), error: null }
  } catch (e) {
    const err = e as ParseError
    return {
      output: indent ? looseFormat(src, indent) : src.replace(/("(?:[^"\\]|\\.)*")|\s+/g, (_m, s) => s ?? ''),
      error: { message: err.message, ...posToLineCol(src, err.pos) },
    }
  }
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*"?)(?=(\s*:))?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\/\/.*|\/\*.*?(?:\*\/|$))|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g

export function tokenizeJsonLine(line: string): Token[] {
  const out: Token[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(line))) {
    const text = m[0]
    const cls = m[1] !== undefined ? (m[2] !== undefined ? 'key' : 'str') : m[3] ? 'num' : m[4] ? 'bool' : m[5] ? 'null' : m[6] ? 'comment' : m[7] ? 'punct' : m[8] ? '' : ''
    out.push({ text, cls })
  }
  return out
}
