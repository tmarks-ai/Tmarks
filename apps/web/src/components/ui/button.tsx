import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  showPendingIndicator?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, disabled, onClick, showPendingIndicator = true, ...props }, ref) => {
    const [pending, setPending] = React.useState(false)
    const Comp = asChild ? Slot : 'button'
    const locked = disabled || pending
    return (
      <Comp
        type={asChild ? undefined : 'button'}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={asChild ? disabled : locked}
        aria-busy={pending || props['aria-busy'] || undefined}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (locked) return
          const result = onClick?.(event) as unknown
          if (!isPromiseLike(result)) return
          setPending(true)
          Promise.resolve(result).finally(() => setPending(false)).catch(() => undefined)
        }}
      >
        {showPendingIndicator && pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {props.children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}

export { Button }
