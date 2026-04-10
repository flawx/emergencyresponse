import type { ReactNode } from 'react'
import { BackButton } from './BackButton'

type Props = {
  title: string
  subtitle?: string
  showBack?: boolean
  children: ReactNode
}

export function PanelLayout({ title, subtitle, showBack = true, children }: Props) {
  return (
    <main className="min-h-screen bg-panel-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4 pb-7">
        <header className="mb-5 mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-wide">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
          </div>
          {showBack ? <BackButton /> : null}
        </header>
        <section className="flex-1">{children}</section>
      </div>
    </main>
  )
}
