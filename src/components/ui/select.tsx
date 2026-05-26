import * as React from 'react'
import { cn } from '@/lib/utils'

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-7 cursor-pointer rounded-md border border-borderx bg-surface2 px-2 text-xs font-medium text-textx outline-none transition-colors focus:border-borderx2',
        props.className,
      )}
    />
  )
}
