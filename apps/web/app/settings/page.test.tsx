// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * Which tab Settings opens on, and where that answer is written down.
 *
 * ⛔ Every channel is stubbed; nothing here reaches a provider.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { IpcChannel } from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const route = vi.hoisted(() => ({
  query: "",
  replaced: [] as string[],
  pushed: [] as string[],
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (path: string) => route.pushed.push(path),
    replace: (path: string) => route.replaced.push(path),
  }),
  useSearchParams: () => new URLSearchParams(route.query),
  usePathname: () => "/settings",
}))

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { default: SettingsPage } = await import("./page")

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  route.query = ""
  route.replaced = []
  route.pushed = []
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel) => {
    switch (channel) {
      case "settings:keys:summary":
        return {
          replicate: { present: false, last4: null, source: "none" },
          openrouter: { present: false, last4: null, source: "none" },
          encryptionAvailable: true,
        }
      case "settings:get":
        return {
          projectRoot: null,
          maxConcurrentJobs: 2,
          pollIntervalMs: 3000,
          preferredAiTool: null,
        }
      case "ai:tools":
        return {
          claude: { id: "claude", available: false, path: null, version: null },
          codex: { id: "codex", available: false, path: null, version: null },
          preferred: null,
          detectedAt: 0,
        }
      default:
        return { ok: true }
    }
  })
})

afterEach(cleanup)

describe("SettingsPage", () => {
  it("opens the tab the URL names, so a tab can be linked to", async () => {
    route.query = "tab=ai"
    renderPage()

    expect(
      await screen.findByRole("tab", { name: "AI helpers", selected: true })
    ).toBeVisible()
  })

  it("falls back to Providers for a tab that does not exist", async () => {
    route.query = "tab=nonsense"
    renderPage()

    expect(
      await screen.findByRole("tab", { name: "Providers", selected: true })
    ).toBeVisible()
  })

  /** `replace`, not `push`: a tab switch is not a place Back should walk. */
  it("writes the chosen tab into the URL", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole("tab", { name: "General" }))

    expect(route.replaced).toEqual(["/settings?tab=general"])
    expect(route.pushed).toEqual([])
  })
})
