import { tokenizeJsonLine } from './json'
import { tokenizeXmlLine } from './xml'
import type { Lang, Token } from './types'

export function tokenize(lang: Lang, line: string): Token[] {
  return lang === 'json' ? tokenizeJsonLine(line) : tokenizeXmlLine(line)
}
