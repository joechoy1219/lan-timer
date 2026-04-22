import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
}

export const Button = ({ children, className, ...props }: ButtonProps) => (
  <button
    {...props}
    className={`mono min-h-11 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs tracking-wide text-white transition hover:border-amber-300 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1d26] disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ''}`}
  >
    {children}
  </button>
)
