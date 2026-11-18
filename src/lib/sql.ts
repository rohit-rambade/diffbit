import type { FormatResult, Token } from './types'

/** Structural keywords: upper-cased, and followed by a space before "(". */
const KEYWORDS = new Set(
  `ADD ALL ALTER AND ANY APPLY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BY CASCADE CASE CATCH CHECK CLOSE CLUSTERED COLUMN COMMIT
  CONSTRAINT CONTINUE CREATE CROSS CURSOR DATABASE DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISTINCT DROP ELSE END EXCEPT EXEC EXECUTE
  EXISTS FETCH FOR FOREIGN FROM FULL FUNCTION GO GOTO GRANT GROUP HAVING IDENTITY IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT
  LIKE LIMIT MATCHED MERGE NEXT NOCOUNT NOLOCK NONCLUSTERED NOT NULL OF OFF OFFSET ON ONLY OPEN OR ORDER OUTER OUTPUT OVER PARTITION PERCENT
  PIVOT PRIMARY PRINT PROC PROCEDURE RAISERROR REFERENCES RETURN RETURNS REVOKE RIGHT ROLLBACK ROWS SCHEMA SELECT SET TABLE THEN THROW TO TOP
  TRAN TRANSACTION TRIGGER TRUNCATE TRY UNION UNIQUE UNPIVOT UPDATE USE USING VALUES VIEW WHEN WHERE WHILE WITH REPLACE TEMPORARY LANGUAGE
  BODY PACKAGE LOOP ELSIF EXCEPTION RETURNING CONFLICT DO NOTHING LATERAL RECURSIVE`.split(/\s+/),
)

/** Functions and types: upper-cased, no space before "(". */
const BUILTINS = new Set(
  `ABS AVG BIGINT BINARY BIT CAST CEILING CHAR CHARINDEX COALESCE CONCAT CONVERT COUNT COUNT_BIG CURRENT_TIMESTAMP DATE DATEADD DATEDIFF
  DATENAME DATEPART DATETIME DATETIME2 DATETIMEOFFSET DAY DECIMAL DENSE_RANK EOMONTH FLOAT FLOOR FORMAT GETDATE GETUTCDATE IIF INT INTEGER
  ISNULL JSON_VALUE JSON_QUERY LAG LEAD LEN LOWER LTRIM MAX MIN MONEY MONTH NCHAR NEWID NTEXT NULLIF NUMERIC NVARCHAR OBJECT_ID RANK REAL
  REPLICATE ROUND ROW_NUMBER RTRIM SCOPE_IDENTITY SMALLINT STRING_AGG STUFF SUBSTRING SUM SYSDATETIME TEXT TIME TINYINT TRIM TRY_CAST
  TRY_CONVERT UNIQUEIDENTIFIER UPPER VARBINARY VARCHAR XML YEAR BOOLEAN SERIAL TIMESTAMP INTERVAL NUMBER VARCHAR2 CLOB BLOB NOW`.split(/\s+/),
)

type TokType = 'ws' | 'line' | 'block' | 'str' | 'ident' | 'num' | 'var' | 'word' | 'open' | 'close' | 'comma' | 'semi' | 'op'
type Tok = { type: TokType; text: string }

const GROUP_TYPES: TokType[] = ['ws', 'line', 'block', 'str', 'ident', 'num', 'var', 'word', 'open', 'close', 'comma', 'semi', 'op', 'op']
const TOKEN_RE =
  /(\s+)|(--[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|([NnEe]?'(?:[^']|'')*'?)|(\[[^\]\n]*\]?|"[^"\n]*"?|`[^`\n]*`?)|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\p{L}_]))|(@@?[\p{L}\p{N}_$#]+|:[\p{L}_][\p{L}\p{N}_]*)|([\p{L}_#$][\p{L}\p{N}_$#.]*)|(\()|(\))|(,)|(;)|(<>|!=|<=|>=|::|\|\||[-+*/%=<>!~&|^.])|([\s\S])/gu

function lex(src: string): Tok[] {
  const out: Tok[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(src))) {
    let g = 1
    while (m[g] === undefined) g++
    out.push({ type: GROUP_TYPES[g - 1], text: m[0] })
  }
  return out
}

const CLAUSE = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'VALUES', 'UPDATE', 'DELETE', 'INSERT', 'MERGE', 'USING', 'DECLARE', 'IF', 'ELSE', 'ELSIF', 'WHILE', 'RETURN', 'PRINT', 'EXEC', 'EXECUTE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'COMMIT', 'ROLLBACK', 'THROW', 'RAISERROR', 'OPEN', 'FETCH', 'CLOSE', 'DEALLOCATE', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'USE', 'SET', 'RETURNING'])
const JOIN_START = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'JOIN'])
const NOT_BLOCK_AFTER_BEGIN = new Set(['TRAN', 'TRANSACTION', 'DISTRIBUTED'])
const OBJECT_WORDS = new Set(['TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'INDEX', 'TRIGGER', 'SCHEMA', 'DATABASE', 'NOT', 'END'])
/** "INSERT INTO t (a, b)" / "CREATE TABLE t (...)": keep a space between the name and "(". */
const SPACE_AFTER_NAME = new Set(['INTO', 'TABLE', 'PROCEDURE', 'PROC', 'VIEW', 'EXISTS'])
/** Clause keywords that stay on the same line when they directly follow one of these words. */
const STAY_INLINE_AFTER: Record<string, string[]> = {
  FROM: ['DELETE', 'NEXT', 'PRIOR', 'FIRST', 'LAST', 'ABSOLUTE', 'RELATIVE'],
  SELECT: ['INSERT', 'ELSE'],
  SET: ['ELSE'],
  IF: ['ELSE'],
  EXEC: ['ELSE'],
  RETURN: ['ELSE'],
}

/**
 * Lightweight SQL beautifier geared towards stored procedures and scripts
 * (T-SQL, PL/SQL, PostgreSQL, MySQL). It never fails: unknown syntax is kept as-is.
 */
export function formatSql(text: string, indent: string): FormatResult {
  const src = text.trim()
  if (!src) return { output: '', error: null }
  if (!indent) return { output: minifySql(src), error: null }

  const toks = lex(src)
  const lines: string[] = []
  let line = ''
  let level = 0 // BEGIN/END nesting + sub-queries
  let hanging = false // continuation lines (after commas, AND/OR) get one extra indent
  const blocks: ('begin' | 'case')[] = []
  const parens: { sub: boolean; level: number; hanging: boolean }[] = []
  let prev: Tok | null = null // previous significant token (as written)
  let prevUnary = false // previous token was a unary +/- sign
  let prevWord = '' // previous significant token, upper-cased, if it was a word
  let prevWord2 = ''
  let betweenPending = false
  let inCreateHeader = false

  const flush = () => {
    if (line.trim()) lines.push(line.replace(/\s+$/, ''))
    line = ''
  }
  const newline = (extra = 0) => {
    flush()
    line = indent.repeat(Math.max(0, level + extra))
  }
  const atLineStart = () => !line.trim()
  const canBreak = () => !blocks.includes('case') && (!parens.length || parens[parens.length - 1].sub)
  const nextSig = (i: number) => {
    for (let j = i + 1; j < toks.length; j++) if (toks[j].type !== 'ws') return j
    return -1
  }
  const write = (t: string, tok: Tok) => {
    if (!atLineStart() && prev) {
      const callParen = tok.type === 'open' && (prev.type === 'word' || prev.type === 'ident') && !KEYWORDS.has(prev.text.toUpperCase()) && !SPACE_AFTER_NAME.has(prevWord2)
      const noSpace = prev.type === 'open' || tok.type === 'close' || tok.type === 'comma' || tok.type === 'semi' || prev.text.endsWith('.') || t.startsWith('.') || prev.text === '::' || t === '::' || callParen || prevUnary
      if (!noSpace) line += ' '
    }
    line += t
    if (tok.type === 'line' || tok.type === 'block') return // comments don't affect spacing decisions
    prevUnary = tok.type === 'op' && (t === '-' || t === '+') && (!prev || ['open', 'comma', 'op'].includes(prev.type) || (prev.type === 'word' && KEYWORDS.has(prev.text.toUpperCase())))
    prev = { ...tok, text: t }
    prevWord2 = prevWord
    prevWord = tok.type === 'word' ? t.toUpperCase() : ''
  }

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]
    if (tok.type === 'ws') continue

    if (tok.type === 'line' || tok.type === 'block') {
      const before = toks[i - 1]
      const ownLine = !before || (before.type === 'ws' && before.text.includes('\n'))
      if (ownLine && !atLineStart()) newline(hanging ? 1 : 0)
      write(tok.text.trim(), tok)
      if (tok.type === 'line' || tok.text.includes('\n')) newline(hanging ? 1 : 0)
      continue
    }

    if (tok.type === 'semi') {
      write(';', tok)
      hanging = false
      inCreateHeader = false
      betweenPending = false
      newline()
      continue
    }

    const ni = nextSig(i)
    const n = ni >= 0 ? toks[ni] : null
    const nUpper = n?.type === 'word' ? n.text.toUpperCase() : ''

    if (tok.type === 'open') {
      const sub = nUpper === 'SELECT' || nUpper === 'WITH'
      write('(', tok)
      parens.push({ sub, level, hanging })
      if (sub) {
        level += hanging ? 2 : 1
        hanging = false
        newline()
      }
      continue
    }
    if (tok.type === 'close') {
      const p = parens.pop()
      if (p?.sub) {
        level = p.level
        hanging = p.hanging
        newline(hanging ? 1 : 0)
      }
      write(')', tok)
      continue
    }
    if (tok.type === 'comma') {
      write(',', tok)
      if (canBreak()) {
        hanging = true
        newline(1)
      }
      continue
    }
    if (tok.type !== 'word') {
      write(tok.text, tok)
      continue
    }

    const upper = tok.text.toUpperCase()
    const text = KEYWORDS.has(upper) || BUILTINS.has(upper) ? upper : tok.text

    if (upper === 'GO' && atLineStart()) {
      level = 0
      blocks.length = 0
      parens.length = 0
      hanging = false
      write('GO', tok)
      flush()
      lines.push('')
      newline()
      continue
    }

    if (upper === 'BEGIN' && !NOT_BLOCK_AFTER_BEGIN.has(nUpper)) {
      hanging = false
      inCreateHeader = false
      if (!atLineStart()) newline()
      write('BEGIN', tok)
      if (nUpper === 'TRY' || nUpper === 'CATCH') {
        write(nUpper, n!)
        i = ni
      }
      blocks.push('begin')
      level++
      newline()
      continue
    }

    if (upper === 'END' && blocks[blocks.length - 1] !== 'case') {
      blocks.pop()
      level = Math.max(0, level - 1)
      hanging = false
      newline()
      write('END', tok)
      if (['TRY', 'CATCH', 'IF', 'LOOP'].includes(nUpper)) {
        write(nUpper, n!)
        i = ni
      }
      const after = nextSig(i)
      if (after < 0 || toks[after].type !== 'semi') newline()
      continue
    }

    if (upper === 'CASE') blocks.push('case')
    else if (upper === 'END') blocks.pop() // closes a CASE, stays inline

    if (canBreak()) {
      const clause = CLAUSE.has(upper) && !(STAY_INLINE_AFTER[upper] ?? []).includes(prevWord) && !(upper === 'IF' && OBJECT_WORDS.has(prevWord))
      const byClause = (upper === 'GROUP' || upper === 'ORDER') && nUpper === 'BY'
      const join = JOIN_START.has(upper) && n?.type !== 'open' && !JOIN_START.has(prevWord) && (upper === 'CROSS' || upper === 'OUTER' ? nUpper === 'JOIN' || nUpper === 'APPLY' : true)
      const last = prev as Tok | null // assigned inside write(); TS can't see that
      const cte = upper === 'WITH' && (last === null || last.type === 'semi')

      if (clause || byClause || join || cte) {
        hanging = false
        if (!atLineStart()) newline()
      } else if ((upper === 'AND' || upper === 'OR') && !betweenPending) {
        hanging = true
        if (!atLineStart()) newline(1)
      } else if (upper === 'AS' && inCreateHeader && !parens.length) {
        inCreateHeader = false
        hanging = false
        newline()
        write('AS', tok)
        newline()
        continue
      }
    }

    if (upper === 'AND' && betweenPending) betweenPending = false
    if (upper === 'BETWEEN') betweenPending = true
    if ((upper === 'CREATE' || upper === 'ALTER') && ['PROCEDURE', 'PROC', 'FUNCTION', 'VIEW', 'TRIGGER', 'OR'].includes(nUpper)) inCreateHeader = true

    write(text, tok)
  }
  flush()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return { output: lines.join('\n'), error: null }
}

function minifySql(src: string) {
  const toks = lex(src)
  const wordy = (x?: Tok) => !!x && ['word', 'num', 'var', 'ident', 'str'].includes(x.type)
  return toks
    .map((t, i) => {
      if (t.type === 'line') return `/*${t.text.slice(2).replace(/\*\//g, '* /')} */`
      if (t.type !== 'ws') return t.text
      return wordy(toks[i - 1]) && wordy(toks[i + 1]) ? ' ' : ''
    })
    .join('')
}

const CLS: Partial<Record<TokType, string>> = { line: 'comment', block: 'comment', str: 'str', num: 'num', var: 'attr', open: 'punct', close: 'punct', comma: 'punct', semi: 'punct', op: 'punct' }

export function tokenizeSqlLine(line: string): Token[] {
  return lex(line).map((t) => {
    let cls = CLS[t.type] ?? ''
    if (t.type === 'word') {
      const u = t.text.toUpperCase()
      cls = KEYWORDS.has(u) ? 'tag' : BUILTINS.has(u) ? 'key' : ''
    }
    return { text: t.text, cls }
  })
}
