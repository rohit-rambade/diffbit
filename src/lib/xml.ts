import type { FormatResult, Token, ValidationError } from './types'

type XNode =
  | { t: 'el'; name: string; attrs: string; selfClose: boolean; children: XNode[] }
  | { t: 'text'; text: string }
  | { t: 'raw'; raw: string; inline: boolean } // comment, cdata, processing instruction, doctype

const NAME_START = /[A-Za-z_:À-￿]/

function scanUntilTagEnd(src: string, from: number) {
  let quote = ''
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return src.length - 1
}

function normalizeAttrs(inner: string) {
  const parts: string[] = []
  const re = /([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) parts.push(m[2] !== undefined ? `${m[1]}=${m[2]}` : m[1])
  return parts.join(' ')
}

/** Lenient XML tree builder. Never throws; mismatched tags are recovered from. */
function parse(src: string): XNode[] {
  const root: XNode = { t: 'el', name: '#root', attrs: '', selfClose: false, children: [] }
  const stack: Extract<XNode, { t: 'el' }>[] = [root]
  const top = () => stack[stack.length - 1]
  let i = 0
  const n = src.length

  const rawUntil = (end: string, inline = false) => {
    const close = src.indexOf(end, i)
    const stop = close < 0 ? n : close + end.length
    top().children.push({ t: 'raw', raw: src.slice(i, stop), inline })
    i = stop
  }

  while (i < n) {
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        rawUntil('-->')
        continue
      }
      if (src.startsWith('<![CDATA[', i)) {
        rawUntil(']]>', true)
        continue
      }
      if (src.startsWith('<?', i)) {
        rawUntil('?>')
        continue
      }
      if (src.startsWith('<!', i)) {
        // DOCTYPE, possibly with an internal subset [ ... ]
        let depth = 0
        let j = i + 2
        for (; j < n; j++) {
          if (src[j] === '[') depth++
          else if (src[j] === ']') depth--
          else if (src[j] === '>' && depth <= 0) break
        }
        top().children.push({ t: 'raw', raw: src.slice(i, j + 1), inline: false })
        i = j + 1
        continue
      }
      if (src[i + 1] === '/') {
        const end = scanUntilTagEnd(src, i)
        const name = src.slice(i + 2, end).trim()
        const idx = stack.map((s) => s.name).lastIndexOf(name)
        if (idx > 0) stack.length = idx
        i = end + 1
        continue
      }
      if (NAME_START.test(src[i + 1] ?? '')) {
        const end = scanUntilTagEnd(src, i)
        let inner = src.slice(i + 1, end)
        const selfClose = inner.endsWith('/')
        if (selfClose) inner = inner.slice(0, -1)
        const nameMatch = /^[^\s/>]+/.exec(inner)
        const name = nameMatch ? nameMatch[0] : inner
        const el: XNode = { t: 'el', name, attrs: normalizeAttrs(inner.slice(name.length)), selfClose, children: [] }
        top().children.push(el)
        if (!selfClose) stack.push(el)
        i = end + 1
        continue
      }
    }
    let next = src.indexOf('<', i + 1)
    if (next < 0) next = n
    const text = src.slice(i, next)
    const last = top().children[top().children.length - 1]
    if (last && last.t === 'text') last.text += text
    else top().children.push({ t: 'text', text })
    i = next
  }
  return root.children
}

function printNodes(nodes: XNode[], indent: string, depth: number, out: string[]) {
  const pad = indent.repeat(depth)
  for (const node of nodes) {
    if (node.t === 'text') {
      const text = node.text.trim()
      if (text) out.push(pad + text)
    } else if (node.t === 'raw') {
      out.push(pad + node.raw.trim())
    } else {
      const open = `<${node.name}${node.attrs ? ' ' + node.attrs : ''}`
      if (node.selfClose) {
        out.push(`${pad}${open}/>`)
        continue
      }
      const kids = node.children.filter((c) => !(c.t === 'text' && !c.text.trim()))
      if (!kids.length) out.push(`${pad}${open}></${node.name}>`)
      else if (kids.every((c) => c.t === 'text' || (c.t === 'raw' && c.inline)) && kids.length === 1) {
        const only = kids[0]
        out.push(`${pad}${open}>${only.t === 'text' ? only.text.trim() : (only as { raw: string }).raw}</${node.name}>`)
      } else {
        out.push(`${pad}${open}>`)
        printNodes(kids, indent, depth + 1, out)
        out.push(`${pad}</${node.name}>`)
      }
    }
  }
}

function minifyNodes(nodes: XNode[]): string {
  return nodes
    .map((node) => {
      if (node.t === 'text') return node.text.trim() ? node.text : ''
      if (node.t === 'raw') return node.raw.trim()
      const open = `<${node.name}${node.attrs ? ' ' + node.attrs : ''}`
      if (node.selfClose) return `${open}/>`
      return `${open}>${minifyNodes(node.children)}</${node.name}>`
    })
    .join('')
}

export function validateXml(text: string): ValidationError | null {
  if (!text.trim() || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(text.trim(), 'application/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (!err) return null
  const msg = err.textContent ?? 'Invalid XML'
  const chrome = /line (\d+) at column (\d+):\s*(.+?)(?:\n|Below|$)/i.exec(msg)
  if (chrome) return { line: +chrome[1], col: +chrome[2], message: chrome[3].trim() }
  const firefox = /XML Parsing Error:\s*(.+?)\n[\s\S]*?Line Number (\d+), Column (\d+)/i.exec(msg)
  if (firefox) return { line: +firefox[2], col: +firefox[3], message: firefox[1].trim() }
  return { line: 1, col: 1, message: msg.split('\n')[0].trim() || 'Invalid XML' }
}

export function formatXml(text: string, indent: string): FormatResult {
  const src = text.trim()
  if (!src) return { output: '', error: null }
  const nodes = parse(src)
  let output: string
  if (!indent) output = minifyNodes(nodes)
  else {
    const lines: string[] = []
    printNodes(nodes, indent, 0, lines)
    output = lines.join('\n')
  }
  return { output, error: validateXml(src) }
}

export function tokenizeXmlLine(line: string): Token[] {
  const out: Token[] = []
  let i = 0
  let inTag = false
  const n = line.length
  const push = (text: string, cls: string) => text && out.push({ text, cls })
  const until = (end: string) => {
    const k = line.indexOf(end, i)
    return k < 0 ? n : k + end.length
  }
  while (i < n) {
    if (!inTag) {
      if (line.startsWith('<!--', i)) {
        const e = until('-->')
        push(line.slice(i, e), 'comment')
        i = e
      } else if (line.startsWith('<![CDATA[', i)) {
        const e = until(']]>')
        push(line.slice(i, e), 'cdata')
        i = e
      } else if (line.startsWith('<?', i) || line.startsWith('<!', i)) {
        const e = until('>')
        push(line.slice(i, e), 'meta')
        i = e
      } else if (line[i] === '<' && (line[i + 1] === '/' || NAME_START.test(line[i + 1] ?? ''))) {
        const p = line[i + 1] === '/' ? '</' : '<'
        push(p, 'punct')
        i += p.length
        const m = /^[^\s/>]+/.exec(line.slice(i))
        if (m) {
          push(m[0], 'tag')
          i += m[0].length
        }
        inTag = true
      } else {
        let k = line.indexOf('<', i + 1)
        if (k < 0) k = n
        push(line.slice(i, k), 'text')
        i = k
      }
    } else {
      const c = line[i]
      if (line.startsWith('/>', i)) {
        push('/>', 'punct')
        i += 2
        inTag = false
      } else if (c === '>') {
        push('>', 'punct')
        i++
        inTag = false
      } else if (c === '=') {
        push('=', 'punct')
        i++
      } else if (c === '"' || c === "'") {
        const k = line.indexOf(c, i + 1)
        const e = k < 0 ? n : k + 1
        push(line.slice(i, e), 'str')
        i = e
      } else if (/\s/.test(c)) {
        const m = /^\s+/.exec(line.slice(i))!
        push(m[0], '')
        i += m[0].length
      } else {
        const m = /^[^\s=>/"']+/.exec(line.slice(i))
        const t = m ? m[0] : c
        push(t, 'attr')
        i += t.length
      }
    }
  }
  return out
}
