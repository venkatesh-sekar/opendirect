"use client"

import Link from "next/link"

import { canvasHref } from "@/lib/shell/routes"

/** Home. The canvas moved to `/canvas/`; the sections arrive next. */
export default function HomePage() {
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 p-8">
      <h1 className="text-sm font-semibold">Home</h1>
      <Link href={canvasHref()} className="text-sm text-muted-foreground">
        Open canvas
      </Link>
    </main>
  )
}
