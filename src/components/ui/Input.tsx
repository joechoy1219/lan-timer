import type { InputHTMLAttributes } from 'react'

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="mono w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-amber-300"
  />
)
