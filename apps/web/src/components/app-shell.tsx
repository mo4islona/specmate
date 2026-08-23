import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { GearIcon } from './icons.tsx'
import { TaskNavigation } from './task-navigation.tsx'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation()
  const isSettings = location.startsWith('/settings')

  return (
    <div className="min-h-full bg-ground text-text lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="hidden min-h-screen flex-col border-r border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="border-b border-border px-5 py-5">
          <Link href="/" className="block">
            <span className="font-mono text-lg font-semibold tracking-[-0.04em] text-phosphor">
              SPECMATE
            </span>
            <span className="mt-1 block text-xs text-muted">mission control / phase 1</span>
          </Link>
          <Link href="/tasks/new" className="button-secondary mt-4 flex w-full justify-center">
            + Launch task
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <TaskNavigation />
        </div>
        <div className="border-t border-border p-3">
          <Link
            href="/settings"
            aria-current={isSettings ? 'page' : undefined}
            className={`flex items-center gap-2 rounded px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors ${
              isSettings
                ? 'bg-phosphor/8 text-text'
                : 'text-muted hover:bg-elevated hover:text-text'
            }`}
          >
            <GearIcon className="h-4 w-4 shrink-0" />
            Settings
          </Link>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-ground/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="font-mono font-semibold text-phosphor">
              SPECMATE
            </Link>
            <Link href="/tasks/new" className="button-secondary py-1.5 text-xs">
              + Task
            </Link>
            <Link
              href="/settings"
              aria-current={isSettings ? 'page' : undefined}
              className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted"
            >
              <GearIcon className="h-4 w-4 shrink-0" />
              Settings
            </Link>
          </div>
          <details className="mt-3 border-t border-border pt-2">
            <summary className="cursor-pointer py-1 font-mono text-xs uppercase tracking-widest text-muted">
              Task index
            </summary>
            <div className="max-h-[55vh] overflow-y-auto pt-3">
              <TaskNavigation />
            </div>
          </details>
        </header>

        <main className="mx-auto min-h-screen w-full max-w-[100rem] overflow-x-hidden p-4 sm:p-6 xl:p-10">
          {children}
        </main>
      </div>
    </div>
  )
}
