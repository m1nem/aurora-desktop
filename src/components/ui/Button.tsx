// AURORA_PATCH: Button v3 - Clean CLI aesthetics
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'glass' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    'border border-[var(--term-border-bright)] bg-[var(--term-bg-input)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] active:opacity-80 font-medium',
  ghost:
    'border border-transparent text-[var(--term-text-muted)] hover:border-[var(--term-border)] hover:text-[var(--term-text-bright)] bg-transparent',
  glass:
    'border border-[var(--term-border)] bg-[var(--term-bg-panel)] text-[var(--term-text)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]',
  subtle:
    'border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]',
  danger:
    'border border-red-800 text-red-400 hover:bg-red-500 hover:text-black hover:border-red-500',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-xs font-medium',
  lg: 'h-10 px-4 text-sm font-medium',
  icon: 'h-8 w-8 text-xs p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-mono select-none whitespace-nowrap transition-none disabled:opacity-40 disabled:pointer-events-none rounded-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
