import type { ReactNode } from 'react'
import { BackButton } from './BackButton'

type Props = {
  title: string
  subtitle?: string
  showBack?: boolean
  children: ReactNode
}

const panelShellClass = [
  'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800',
  'bg-gradient-to-b from-slate-900 to-panel-950',
  'shadow-[0_10px_40px_rgba(0,0,0,0.8),inset_0_2px_6px_rgba(0,0,0,0.55)]',
  'before:pointer-events-none before:absolute before:inset-1 before:rounded-xl before:border',
  'before:border-slate-700/50 before:content-[\'\']',
].join(' ')

export function PanelLayout({ title, subtitle, showBack = true, children }: Props) {
  return (
    <main className="relative z-10 min-h-screen text-slate-200">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4 pb-7">
        <div className={panelShellClass}>
          <div className="relative z-10 flex min-h-0 flex-1 flex-col p-4 pb-7">
            <header className="mb-5 mt-1 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-normal">{title}</h1>
                {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
              </div>
              {showBack ? <BackButton /> : null}
            </header>
            <section className="flex-1">{children}</section>
          </div>
        </div>
      </div>
    </main>
  )
}
