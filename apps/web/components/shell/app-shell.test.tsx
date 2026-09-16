// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"

import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"

const route = vi.hoisted(() => ({ pathname: "/", pushed: [] as string[] }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (path: string) => route.pushed.push(path) }),
  usePathname: () => route.pathname,
}))

// `next/link` wants the App Router's context, which no unit test mounts.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

/**
 * The preload script injects `window.opendirect` before the bundle runs, so the
 * bridge is present on the client and absent during the export's prerender.
 * The flag is what lets one test play both sides.
 */
const bridge = vi.hoisted(() => ({
  present: false,
  // Channels answered for a test that needs the shell to get past its loading
  // states. Anything not named here stays pending, which is what the hydration
  // tests below are actually about.
  responses: {} as Record<string, unknown>,
  listeners: {} as Record<string, ((payload: unknown) => void)[]>,
}))

vi.mock("@/lib/ipc", () => ({
  invoke: (channel: string) =>
    channel in bridge.responses
      ? Promise.resolve(bridge.responses[channel])
      : new Promise(() => {}),
  isBridgeAvailable: () => bridge.present,
  pathsForFiles: () => [],
  subscribe: (channel: string, listener: (payload: never) => void) => {
    const listeners = (bridge.listeners[channel] ??= [])
    listeners.push(listener as (payload: unknown) => void)
    return () => {
      listeners.splice(listeners.indexOf(listener as never), 1)
    }
  },
}))

/**
 * ⌘, as the browser delivers it. `react-hotkeys-hook` matches on
 * `KeyboardEvent.code`, and `mod` is Control off Apple hardware — which is
 * what jsdom's user agent claims to be.
 */
function press() {
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        ctrlKey: true,
        bubbles: true,
      })
    )
  )
}

/** Fires a main→renderer push the way the preload bridge would. */
function emit(channel: string, payload: unknown) {
  for (const listener of bridge.listeners[channel] ?? []) listener(payload)
}

const { AppShell } = await import("./app-shell")

function Shell({ children }: { children?: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AppShell>{children}</AppShell>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/**
 * The hydration tests below mount their own roots, which Testing Library's
 * `cleanup` knows nothing about. Left mounted they keep their document-level
 * listeners — including the ⌘, hotkey — and a later test's keystroke reaches
 * every shell that was ever hydrated.
 */
const roots: Root[] = []

function hydrate(
  container: HTMLElement,
  options?: Parameters<typeof hydrateRoot>[2]
) {
  const root = hydrateRoot(container, <Shell />, options)
  roots.push(root)
  return root
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  cleanup()
  bridge.present = false
  bridge.responses = {}
  bridge.listeners = {}
  route.pathname = "/"
  route.pushed = []
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
      hydrate(container, {
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
      hydrate(container, { onRecoverableError: () => {} })
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
      hydrate(container, {
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

  /**
   * The bug this shell was reorganised for: Settings used to be a peer of the
   * canvas rather than a child of the window, so pushing `/settings` unmounted
   * the sidebar and left no way back.
   */
  it("keeps the sidebar mounted on the settings route", async () => {
    bridge.present = true
    bridge.responses = {
      "project:current": { project: { name: "Nikita", path: "/tmp/nikita" } },
      "containers:tree": [],
    }
    route.pathname = "/settings"

    render(
      <Shell>
        <main>Settings content</main>
      </Shell>
    )

    expect(await screen.findByText("Nikita")).toBeVisible()
    const settings = await screen.findByRole("link", { name: /settings/i })
    expect(settings).toHaveAttribute("href", "/settings")
    // The row for the screen you are on is marked as such.
    expect(settings).toHaveAttribute("data-active")
    expect(screen.getByText("Settings content")).toBeVisible()
  })

  it("renders the canvas route inside the same shell", async () => {
    bridge.present = true
    bridge.responses = {
      "project:current": { project: { name: "Nikita", path: "/tmp/nikita" } },
      "containers:tree": [],
    }
    route.pathname = "/"

    render(
      <Shell>
        <main>Canvas</main>
      </Shell>
    )

    expect(await screen.findByText("Nikita")).toBeVisible()
    const settings = await screen.findByRole("link", { name: /settings/i })
    expect(settings).not.toHaveAttribute("data-active")
  })

  /**
   * `CmdOrCtrl+,` is an application-menu accelerator in the packaged app, and
   * a menu accelerator pre-empts anything the renderer binds — so the menu
   * item, not the ⌘, hotkey below it, is what the chord does there. The menu
   * cannot know which route is mounted, so it asks for a toggle and this is
   * where the toggle is decided; otherwise the same chord would mean two
   * different things on the desktop and in a browser tab.
   */
  it("toggles back out of Settings when the menu asks it to", async () => {
    bridge.present = true
    bridge.responses = {
      "project:current": { project: { name: "Nikita", path: "/tmp/nikita" } },
      "containers:tree": [],
    }
    route.pathname = "/settings/"

    render(
      <Shell>
        <main>Settings content</main>
      </Shell>
    )
    await screen.findByText("Nikita")

    act(() => emit("shell:navigate", { path: "/settings", toggle: true }))
    expect(route.pushed).toEqual(["/"])
  })

  it("goes to Settings from the canvas on the same menu item", async () => {
    bridge.present = true
    bridge.responses = {
      "project:current": { project: { name: "Nikita", path: "/tmp/nikita" } },
      "containers:tree": [],
    }
    route.pathname = "/"

    render(
      <Shell>
        <main>Canvas</main>
      </Shell>
    )
    await screen.findByText("Nikita")

    act(() => emit("shell:navigate", { path: "/settings", toggle: true }))
    expect(route.pushed).toEqual(["/settings"])
  })

  /**
   * The browser dev path (`pnpm dev:web`) has no application menu, so here the
   * renderer's own chord is the only ⌘, there is — and it has to mean what the
   * menu item means in the packaged app.
   */
  it("toggles Settings on the renderer's own chord where there is no menu", async () => {
    bridge.present = false
    route.pathname = "/"

    render(<Shell />)

    press()
    expect(route.pushed).toEqual(["/settings"])

    cleanup()
    route.pathname = "/settings"
    route.pushed = []
    render(<Shell />)

    press()
    expect(route.pushed).toEqual(["/"])
  })

  /** The project name is the switcher, and now says so. */
  it("labels the project header as the project switcher", async () => {
    bridge.present = true
    bridge.responses = {
      "project:current": { project: { name: "Nikita", path: "/tmp/nikita" } },
      "containers:tree": [],
    }

    render(<Shell />)

    expect(
      await screen.findByRole("button", { name: /switch project/i })
    ).toBeVisible()
  })

  it("still shows Settings when no project is open", async () => {
    bridge.present = true
    bridge.responses = { "project:current": { project: null } }
    route.pathname = "/settings"

    render(
      <Shell>
        <main>Settings content</main>
      </Shell>
    )

    // The launcher would otherwise swallow the route the user asked for.
    expect(await screen.findByText("Settings content")).toBeVisible()
  })
})
