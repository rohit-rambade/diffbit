import { formatJson, tokenizeJsonLine, validateJson } from './json'
import { formatSql, tokenizeSqlLine } from './sql'
import { formatXml, tokenizeXmlLine, validateXml } from './xml'
import type { FormatResult, Lang, Token, ValidationError } from './types'

export type LangInfo = {
  label: string
  /** Has a beautifier (Format button, "Ignore formatting" compare). */
  formats: boolean
  minifies: boolean
  /** Checks syntax and shows Valid / error in the editor status bar. */
  validates: boolean
  /** Re-format the whole document on paste / file load. */
  formatOnPaste: boolean
  /** Default for "Ignore formatting" in the diff. */
  normalizeByDefault: boolean
  /** Offer "Ignore case" (SQL keywords and plain text are often case-insensitive). */
  caseOption: boolean
  accept: string
}

export const LANGS: Record<Lang, LangInfo> = {
  json: { label: 'JSON', formats: true, minifies: true, validates: true, formatOnPaste: true, normalizeByDefault: true, caseOption: false, accept: '.json,application/json,text/plain' },
  xml: { label: 'XML', formats: true, minifies: true, validates: true, formatOnPaste: true, normalizeByDefault: true, caseOption: false, accept: '.xml,.xsd,.xsl,.xslt,.svg,.config,.csproj,text/xml,application/xml,text/plain' },
  // Stored procedures are usually compared as written, so SQL is not reformatted on paste or before diffing by default.
  sql: { label: 'SQL', formats: true, minifies: true, validates: false, formatOnPaste: false, normalizeByDefault: false, caseOption: true, accept: '.sql,.prc,.pks,.pkb,.ddl,.txt,text/plain' },
  text: { label: 'Text', formats: false, minifies: false, validates: false, formatOnPaste: false, normalizeByDefault: false, caseOption: true, accept: '' },
}

export const LANG_ORDER: Lang[] = ['json', 'xml', 'sql', 'text']

export function formatLang(lang: Lang, text: string, indent: string, sortKeys = false): FormatResult {
  if (lang === 'json') return formatJson(text, indent, sortKeys)
  if (lang === 'xml') return formatXml(text, indent)
  if (lang === 'sql') return formatSql(text, indent)
  return { output: text, error: null }
}

export function validateLang(lang: Lang, text: string): ValidationError | null {
  if (lang === 'json') return validateJson(text)
  if (lang === 'xml') return validateXml(text)
  return null
}

export function tokenize(lang: Lang, line: string): Token[] {
  if (lang === 'json') return tokenizeJsonLine(line)
  if (lang === 'xml') return tokenizeXmlLine(line)
  if (lang === 'sql') return tokenizeSqlLine(line)
  return line ? [{ text: line, cls: '' }] : []
}
