import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SESSION_TEXT } from '../lib/session.constants'

type Props = {
  title: string
  subtitle: string
  children: ReactNode
}

// The login and register pages' frame: no sidebar or mobile nav, one centred card.
export default function SignInLayout({ title, subtitle, children }: Props) {
  return (
    <main className="flex min-h-dvh items-start justify-center overflow-auto bg-sign-in-bg px-4 py-10 sm:items-center">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-md border border-border bg-sign-in-card p-6 shadow-card">
        <div className="flex items-center gap-3">
          <ShieldCheck size={32} className="text-primary" aria-hidden="true" />
          <p className="font-semibold">{SESSION_TEXT.appName}</p>
        </div>
        <header>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-text-muted">{subtitle}</p>
        </header>
        {children}
      </div>
    </main>
  )
}
