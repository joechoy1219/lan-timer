import type { InputHTMLAttributes } from 'react'

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="mono min-h-11 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-amber-300 focus-visible:ring-2 focus-visible:ring-amber-200/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1d26]"
  />
)
