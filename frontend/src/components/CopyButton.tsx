import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { AppError } from '../models/app-error'
import { useAppDispatch } from '../store/hooks'
import { errorReported } from '../store/listener'
import { ERROR_CODE } from '../utils/error-messages'

type Props = {
  text: string
  label?: string
  // `icon` (plan 034): the icon alone, with `label` as its accessible name and tooltip.
  variant?: 'dark' | 'outline' | 'soft' | 'icon'
  // The success toast (plan 032: Contact Support names what was copied).
  successMessage?: string
}

const COPY_TEXT = { copied: 'Copied to clipboard' } as const

const variantClass = {
  dark: 'text-code-text hover:text-white',
  outline: 'w-full justify-center rounded-md border border-border px-3 py-2 text-primary hover:bg-page-bg',
  soft: 'rounded-md border border-input-border bg-surface px-3 py-1.5 text-text hover:bg-page-bg',
  icon: 'size-8 shrink-0 cursor-pointer justify-center rounded-md border border-input-border bg-surface text-primary hover:border-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
}

export default function CopyButton({ text, label = 'Copy', variant = 'dark', successMessage = COPY_TEXT.copied }: Props) {
  const dispatch = useAppDispatch()
  const iconOnly = variant === 'icon'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(successMessage)
    } catch (error) {
      dispatch(errorReported(AppError.from(error, ERROR_CODE.clipboard).toJSON()))
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={`inline-flex items-center gap-2 text-xs font-medium ${variantClass[variant]}`}
    >
      <Copy size={iconOnly ? 16 : 14} aria-hidden="true" />
      {!iconOnly && label}
    </button>
  )
}
