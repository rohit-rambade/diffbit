import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-borderx2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-textx text-bg hover:opacity-85',
        outline: 'border border-borderx bg-transparent text-mutedx hover:border-borderx2 hover:text-textx',
        ghost: 'bg-transparent text-mutedx hover:bg-surface2 hover:text-textx',
      },
      size: {
        sm: 'h-7 px-3',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
))
Button.displayName = 'Button'
