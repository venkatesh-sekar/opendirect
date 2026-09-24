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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  settingsDefaults,
  type ModelKind,
  type ModelSummary,
  type ReferenceRole,
  type RegistryFamilyEntry,
} from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { ModelPicker } from "./model-picker"

const invoke = vi.hoisted(() => vi.fn())
const pushed = vi.hoisted(() => [] as string[])

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (path: string) => pushed.push(path),
    replace: () => {},
  }),
}))

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

/** Seedance 2.5, mapped on both providers; only Replicate holds a key. */
const seedance: RegistryFamilyEntry = {
  family: {
    id: "seedance-2-5",
    name: "Seedance 2.5",
    kind: "video",
    endpoints: [
      {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        inputs: {
          first_frame: { field: "image", kind: "image" },
          last_frame: { field: "last_frame_image", kind: "image" },
          reference: { field: "reference_images", kind: "image" },
        },
        controls: { prompt: { field: "prompt" } },
      },
      {
        provider: "openrouter",
        model: "bytedance/seedance-2.5",
        inputs: { first_frame: { field: "first_frame", kind: "image" } },
        controls: { prompt: { field: "prompt" } },
      },
    ],
  },
  source: "bundled",
  shadows: [],
  warnings: [],
}

const seedanceSummary = {
  key: "replicate:bytedance/seedance-2.5",
  provider: "replicate" as const,
  slug: "bytedance/seedance-2.5",
  name: "bytedance/seedance-2.5",
  kind: "video" as const,
  priceHint: null,
}

interface Registry {
  families?: RegistryFamilyEntry[]
  capabilities?: Record<string, ReferenceRole[]>
  includeUnverified?: boolean
  catalog?: Array<
    Pick<
      ModelSummary,
      "key" | "provider" | "slug" | "name" | "kind" | "priceHint"
    >
  >
}

function serve(registry: Registry = {}) {
  const catalog = registry.catalog ?? models
  invoke.mockImplementation((channel: string, input?: unknown) => {
    if (channel === "models:list") {
      return Promise.resolve({ models: catalog, failures: [] })
    }
    if (channel === "registry:families") {
      return Promise.resolve(registry.families ?? [])
    }
    if (channel === "registry:capabilities") {
      return Promise.resolve(registry.capabilities ?? {})
    }
    if (channel === "settings:get") {
      return Promise.resolve({
        ...settingsDefaults,
        includeUnverified: registry.includeUnverified ?? false,
      })
    }
    if (channel === "settings:set") {
      return Promise.resolve({
        ...settingsDefaults,
        ...(input as object),
      })
    }
    if (channel === "settings:keys:summary") {
      return Promise.resolve({
        encryptionAvailable: true,
        replicate: { present: true, last4: "abcd", source: "vault" },
        openrouter: { present: false, last4: null, source: "none" },
      })
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

function mount(
  props: {
    value?: string | null
    onChange?: (key: string) => void
    kinds?: ModelKind[]
  } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ModelPicker
          value={props.value ?? null}
          onChange={props.onChange ?? (() => {})}
          kinds={props.kinds}
          hotkeys={false}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function rows() {
  return document.querySelectorAll('[data-slot="command-item"]')
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  pushed.length = 0
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

  it("offers no modality tabs when the node takes one kind only", async () => {
    serve()
    const user = userEvent.setup()
    mount({ kinds: ["image"] })

    await user.click(screen.getByRole("combobox"))
    await screen.findByPlaceholderText("Search models…")
    expect(
      screen.queryByRole("group", { name: "Filter models by modality" })
    ).toBeNull()
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

describe("ModelPicker — families and capability filters", () => {
  const small = [seedanceSummary, ...models.slice(0, 3)]

  async function open(registry: Registry = {}, props = {}) {
    serve({ families: [seedance], catalog: small, ...registry })
    const user = userEvent.setup()
    mount(props)
    await user.click(screen.getByRole("combobox"))
    await screen.findByText("Seedance 2.5")
    return user
  }

  it("lists a mapped family once and picks it by its family key", async () => {
    const onChange = vi.fn()
    const user = await open({}, { onChange })

    // The endpoint summary is not listed on its own.
    expect(screen.queryByText("bytedance/seedance-2.5")).toBeNull()
    const row = screen
      .getByText("Seedance 2.5")
      .closest('[data-slot="command-item"]')!
    expect(within(row as HTMLElement).getByText("Replicate")).toBeVisible()
    expect(within(row as HTMLElement).getByText("no key")).toBeVisible()

    await user.click(screen.getByText("Seedance 2.5"))
    expect(onChange).toHaveBeenCalledWith("family:seedance-2-5")
  })

  it("names the family on the trigger, for a family key or one of its endpoints", async () => {
    serve({ families: [seedance], catalog: small })
    mount({ value: "family:seedance-2-5" })
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveTextContent("Seedance 2.5")
    )
    cleanup()

    serve({ families: [seedance], catalog: small })
    mount({ value: "replicate:bytedance/seedance-2.5" })
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveTextContent(
        "Seedance 2.5 · Replicate"
      )
    )
  })

  it("filters by what a model takes, and says honestly when nothing mapped does", async () => {
    const user = await open()

    await user.click(screen.getByRole("button", { name: /First frame/ }))
    expect(screen.getByText("Seedance 2.5")).toBeVisible()
    expect(screen.queryByText("Model 0")).toBeNull()
    // None of them has been inspected, and the line says so: the chip
    // counts only what is known to take a role.
    expect(screen.getByTestId("unverified-hidden")).toHaveTextContent(
      "3 unverified models hidden, none inspected yet"
    )

    await user.click(screen.getByRole("button", { name: /First frame/ }))
    await user.click(screen.getByRole("button", { name: /Character/ }))
    const empty = screen.getByTestId("model-picker-empty")
    expect(empty).toHaveTextContent(/No mapped model takes Character yet/)
    expect(
      within(empty).getByRole("button", { name: /Include unverified/ })
    ).toBeVisible()
    expect(
      within(empty).getByRole("button", { name: /Create a mapping/ })
    ).toBeVisible()
  })

  it("persists the Include unverified switch through settings:set", async () => {
    const user = await open()

    await user.click(screen.getByRole("switch", { name: "Include unverified" }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:set", {
        includeUnverified: true,
      })
    )
  })

  it("shows unverified models that match their inspected roles", async () => {
    const user = await open({
      includeUnverified: true,
      capabilities: { "replicate:acme/model-1": ["character"] },
    })

    await user.click(screen.getByRole("button", { name: /Character/ }))
    const row = screen
      .getByText("Model 1")
      .closest('[data-slot="command-item"]')!
    expect(within(row as HTMLElement).getByText("unverified")).toBeVisible()
    // Models main has not inspected trail in their own group.
    expect(screen.getByText("Not inspected yet")).toBeVisible()
    expect(screen.getByText("Model 0")).toBeVisible()
  })

  it("opens the mapping editor for an unmapped model", async () => {
    const onChange = vi.fn()
    const user = await open({}, { onChange })

    const row = screen
      .getByText("Model 2")
      .closest('[data-slot="command-item"]')!
    await user.click(
      within(row as HTMLElement).getByRole("button", { name: /Map this model/ })
    )
    expect(pushed).toEqual([
      `/settings?tab=models&map=${encodeURIComponent("replicate:acme/model-2")}`,
    ])
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps the map button out of the Tab order and says how to reach it", async () => {
    await open()

    const row = screen
      .getByText("Model 2")
      .closest('[data-slot="command-item"]') as HTMLElement
    expect(
      within(row).getByRole("button", { name: /Map this model/ })
    ).toHaveAttribute("tabindex", "-1")
    expect(row).toHaveAccessibleDescription(/map this model/i)
  })

  it("maps the highlighted model with Ctrl+E, and picks nothing", async () => {
    const onChange = vi.fn()
    const user = await open({}, { onChange })

    await user.click(screen.getByPlaceholderText("Search models…"))
    await user.type(screen.getByPlaceholderText("Search models…"), "model 1")
    await waitFor(() =>
      expect(
        screen.getByText("Model 1").closest('[data-slot="command-item"]')
      ).toHaveAttribute("data-selected", "true")
    )
    await user.keyboard("{Control>}e{/Control}")

    expect(pushed).toEqual([
      `/settings?tab=models&map=${encodeURIComponent("replicate:acme/model-1")}`,
    ])
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does nothing on Ctrl+E when a family is highlighted", async () => {
    const user = await open()

    await user.type(screen.getByPlaceholderText("Search models…"), "seedance")
    await user.keyboard("{Control>}e{/Control}")
    expect(pushed).toEqual([])
  })
})
