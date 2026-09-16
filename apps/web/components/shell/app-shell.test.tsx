// @vitest-environment jsdom
import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}))

/**
 * The preload script injects `window.opendirect` before the bundle runs, so the
 * bridge is present on the client and absent during the export's prerender.
 * The flag is what lets one test play both sides.
 */
const bridge = vi.hoisted(() => ({ present: false }))

vi.mock("@/lib/ipc", () => ({
  // Nothing resolves: every query stays pending, which is the state both the
  // prerender and the first client render are actually in.
  invoke: () => new Promise(() => {}),
  isBridgeAvailable: () => bridge.present,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { AppShell } = await import("./app-shell")

function Shell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  bridge.present = false
  document.body.innerHTML = ""
})

describe("AppShell", () => {
  it("hydrates the prerendered markup cleanly inside Electron", async () => {
    // The static export is prerendered in Node, where no preload has run.
    bridge.present = false
    const prerendered = renderToString(<Shell />)

    const container = document.createElement("div")
    container.innerHTML = prerendered
    document.body.appendChild(container)

    // The same HTML is then loaded in the Electron window, where it has.
    bridge.present = true

    const recoverable: string[] = []
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    await act(async () => {
      hydrateRoot(container, <Shell />, {
        onRecoverableError: (error) =>
          recoverable.push(
            error instanceof Error ? error.message : String(error)
          ),
      })
    })

    expect(recoverable).toEqual([])
  })

  it("keeps next-themes' blocking theme script out of the client render", async () => {
    bridge.present = false
    const prerendered = renderToString(<Shell />)

    const container = document.createElement("div")
    container.innerHTML = prerendered
    document.body.appendChild(container)
    const prerenderedScript = container.querySelector("script")
    expect(prerenderedScript).not.toBeNull()

    bridge.present = true
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    await act(async () => {
      hydrateRoot(container, <Shell />, { onRecoverableError: () => {} })
    })

    // React creates a fresh script element whenever it rebuilds a tree instead
    // of hydrating it, and a script it creates is never executed — which is
    // what "Encountered a script tag while rendering React component" reports.
    // The prerendered script must be the very node React adopted.
    expect(container.querySelector("script")).toBe(prerenderedScript)
  })
  it("still explains itself once hydrated in a plain browser tab", async () => {
    bridge.present = false
    const container = document.createElement("div")
    container.innerHTML = renderToString(<Shell />)
    document.body.appendChild(container)

    // The prerender cannot know which window it is in, so it commits to
    // neither: the message arrives once the client has looked.
    expect(container.textContent).not.toContain("desktop window")

    const recoverable: string[] = []
    await act(async () => {
      hydrateRoot(container, <Shell />, {
        onRecoverableError: (error) =>
          recoverable.push(
            error instanceof Error ? error.message : String(error)
          ),
      })
    })

    expect(recoverable).toEqual([])
    expect(container.textContent).toContain(
      "OpenDirect runs in its desktop window"
    )
  })
})
