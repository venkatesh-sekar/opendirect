// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The picker, against a catalog large enough to feel it.
 *
 * Opening it used to mount every row the providers list, and `cmdk` then
 * re-scored all of them on every keystroke. The two things asserted here are
 * the two the user actually feels: what is *mounted* is bounded however big
 * the catalog gets, and a model far past that bound is still one search away.
 *
 * ⛔ Every channel is stubbed. `models:list` is a listing, never a generation,
 * and nothing here submits anything.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ModelPicker } from "./model-picker"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

/** A catalog far larger than any popup should mount at once. */
const models = Array.from({ length: 300 }, (_, index) => ({
  key: `replicate:acme/model-${index}`,
  provider: "replicate" as const,
  slug: `acme/model-${index}`,
  name: `Model ${index}`,
  kind: "image" as const,
  priceHint: null,
}))

function serve() {
  invoke.mockImplementation((channel: string) => {
    if (channel === "models:list") {
      return Promise.resolve({ models, failures: [] })
    }
    if (channel === "models:recommended") {
      return Promise.resolve({ video: [], image: [] })
    }
    if (channel === "app:info") {
      return Promise.resolve({ catalogRefreshAccelerator: "mod+shift+r" })
    }
    return new Promise(() => {})
  })
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ModelPicker value={null} onChange={() => {}} hotkeys={false} />
    </QueryClientProvider>
  )
}

function rows() {
  return document.querySelectorAll('[data-slot="command-item"]')
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("ModelPicker", () => {
  it("mounts a bounded number of rows however big the catalog is", async () => {
    serve()
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole("combobox"))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))

    // A cap plus the catalog actions — never 300.
    expect(rows().length).toBeLessThan(40)
    expect(screen.getByTestId("model-rows-truncated")).toBeVisible()
  })

  it("finds a model past the cap by typing, with no debounce in the way", async () => {
    serve()
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole("combobox"))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    expect(screen.queryByText("Model 289")).toBeNull()

    await user.type(screen.getByPlaceholderText("Search models…"), "model 289")
    // No timers advanced: the filter is synchronous with the keystroke.
    expect(await screen.findByText("Model 289")).toBeVisible()
  })

  it("says so when nothing matches", async () => {
    serve()
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole("combobox"))
    await waitFor(() => expect(rows().length).toBeGreaterThan(1))

    await user.type(screen.getByPlaceholderText("Search models…"), "zzzzz")
    expect(await screen.findByTestId("model-picker-empty")).toBeVisible()
  })
})
