import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
}

export const Button = ({ children, className, ...props }: ButtonProps) => (
  <button
    {...props}
    className={`mono rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-xs tracking-wide text-white transition hover:border-amber-300 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 ${className ?? ''}`}
  >
    {children}
  </button>
)
