"use client"

/**
 * The renderer's error boundary.
 *
 * Without it a thrown render error leaves an Electron window blank, with the
 * stack only in a DevTools console the user has no reason to open — the
 * desktop equivalent of a white screen of death. So it says what happened,
 * offers the one action that usually fixes it, and keeps the digest visible
 * because that is what a bug report needs.
 *
 * Nothing is retried automatically and nothing is re-submitted: `reset()`
 * re-renders the tree, it does not replay whatever the user was doing.
 */
import { useEffect } from "react"
import { Button } from "@workspace/ui/components/button"

export default function RendererError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The main process collects the renderer console, so this reaches
    // electron-log and the log file with it.
    console.error("Renderer error boundary caught:", error)
  }, [error])

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-sm font-medium">Something broke in the window</h1>
          <p className="text-sm text-muted-foreground">
            Your project is untouched — this is the interface, not your files.
            Nothing was sent to a provider and no run was started.
          </p>
        </div>

        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : null}
        </pre>

        <div className="flex items-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the window
          </Button>
        </div>
      </div>
    </main>
  )
}
