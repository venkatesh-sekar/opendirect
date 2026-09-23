"use client"

import type { ReactNode } from "react"

export interface WorkspacePageProps {
  /** The page's name, or a breadcrumb, in the top bar. */
  title: ReactNode
  /** Buttons at the right of the top bar. */
  actions?: ReactNode
  /** A right-hand rail beside the content — Home's "Generating now". */
  rail?: ReactNode
  children: ReactNode
}

/**
 * The frame every project page shares: a 60px top bar with the page's name
 * and its actions, then the content, scrolling on its own so the status strip
 * the shell renders underneath stays at the bottom of the window.
 */
export function WorkspacePage({
  title,
  actions,
  rail,
  children,
}: WorkspacePageProps) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-15 shrink-0 items-center justify-between gap-4 border-b px-8">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
          {children}
        </div>
        {rail}
      </div>
    </main>
  )
}

export interface SectionProps {
  title: string
  /** Shown dimmed after the title: "Characters 6". */
  count?: number | null
  /** The "View all →" or "All generations →" at the right of the heading. */
  link?: ReactNode
  children: ReactNode
}

/** One titled block of a page, named for assistive tech by its heading. */
export function Section({ title, count, link, children }: SectionProps) {
  const id = `section-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight">
          {title}
          {count != null ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h2>
        {link}
      </div>
      {children}
    </section>
  )
}
