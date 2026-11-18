import type { Token } from '@/lib/types'

export function Tokens({ tokens }: { tokens: Token[] }) {
  if (!tokens.length) return <>{'​'}</>
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={(t.cls ? `tk-${t.cls}` : '') + (t.mark ? ' mk' : '')}>
          {t.text}
        </span>
      ))}
    </>
  )
}
