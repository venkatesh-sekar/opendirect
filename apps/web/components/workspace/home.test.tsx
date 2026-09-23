// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
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

import { asset, container, generation, job, MINUTE, summary } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())
const pushed = vi.hoisted(() => [] as string[])

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: (path: string) => pushed.push(path) }),
}))

// `next/link` wants the App Router's context, which no unit test mounts.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: ReactNode
  }) => createElement("a", { href, ...props }, children),
}))

const { Home } = await import("./home")

type Responses = Record<string, unknown>

function mount(responses: Responses) {
  invoke.mockImplementation((channel: string, input: unknown) => {
    if (responses[channel] instanceof Error)
      return Promise.reject(responses[channel])
    if (channel === "containers:create")
      return Promise.resolve(
        container({
          id: "made",
          ...(input as { name: string; kind: "character" }),
        })
      )
    return channel in responses
      ? Promise.resolve(responses[channel])
      : new Promise(() => {})
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Home />
    </QueryClientProvider>
  )
}

const EMPTY: Responses = {
  "containers:tree": [],
  "containers:summaries": [],
  "generations:list": { items: [], total: 0, nextOffset: null, outputs: [] },
  "jobs:list": [],
}

const finished = generation({
  id: "g-old",
  prompt: "@mira in the hotel hallway, 35mm",
  createdAt: Date.now() - 2 * MINUTE,
})
const clip = generation({
  id: "g-clip",
  modelSlug: "bytedance/seedance-2.5",
  kind: "video",
  prompt: "Slow dolly down the corridor",
  createdAt: Date.now() - 5 * MINUTE,
})

const FULL: Responses = {
  "containers:tree": [
    container({
      id: "mira",
      name: "Mira",
      handle: "mira",
      referenceAssetIds: ["sheet"],
    }),
    container({ id: "ruiz", name: "Det. Ruiz", handle: "ruiz" }),
    container({ id: "hall", name: "Hotel hallway", kind: "scene" }),
  ],
  "containers:summaries": [
    summary({ id: "mira", assetCount: 12, coverAsset: asset({ id: "sheet" }) }),
    summary({ id: "ruiz", assetCount: 1, coverAsset: asset({ id: "r" }) }),
    summary({ id: "hall", assetCount: 24 }),
  ],
  "generations:list": {
    items: [generation({ id: "g-run", status: "running" }), finished, clip],
    total: 3,
    nextOffset: null,
    outputs: [
      asset({ id: "out", generationId: "g-old" }),
      asset({
        id: "vid",
        kind: "video",
        generationId: "g-clip",
        durationMs: 5_000,
      }),
    ],
  },
  "jobs:list": [job()],
  "generations:get": { generation: finished, inputs: [] },
  "generations:lineage": {
    generation: finished,
    ancestors: [],
    descendants: [],
  },
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  pushed.length = 0
})

/** ⛔ Home only ever reads. No path through it may queue a paid run. */
function expectNothingSpent() {
  const channels = invoke.mock.calls.map(([channel]) => channel as string)
  expect(channels).not.toContain("generations:submit")
  expect(channels).not.toContain("generations:submitBatch")
  expect(channels).not.toContain("jobs:retry")
  expect(channels).not.toContain("jobs:resume")
}

describe("Home", () => {
  it("offers a first step in every section of an empty project", async () => {
    mount(EMPTY)

    const main = await screen.findByRole("main")
    expect(within(main).getByRole("heading", { name: "Home" })).toBeVisible()
    expect(
      await screen.findByText(/nothing generated yet/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /create your first character/i })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /create your first scene/i })
    ).toBeVisible()
    expect(screen.getByText(/nothing generating/i)).toBeInTheDocument()
  })

  /** A failed read is not an empty project, and must not say it is. */
  it("says the strip failed to load instead of claiming nothing was generated", async () => {
    mount({
      ...EMPTY,
      "generations:list": new Error("The project database is locked"),
    })

    const strip = await screen.findByRole("region", { name: "Continue" })
    expect(await within(strip).findByRole("alert")).toHaveTextContent(
      "The project database is locked"
    )
    expect(within(strip).queryByText(/nothing generated yet/i)).toBeNull()
  })

  it("opens the canvas from the top bar", async () => {
    mount(EMPTY)
    const bar = await screen.findByRole("banner")
    expect(
      within(bar).getByRole("link", { name: /open canvas/i })
    ).toHaveAttribute("href", "/canvas/")
  })

  it("continues with running jobs first, then the latest runs", async () => {
    mount(FULL)

    const strip = await screen.findByRole("region", { name: "Continue" })
    await within(strip).findByText("@mira in the hotel hallway, 35mm")
    const tiles = within(strip).getAllByRole("button")
    expect(tiles).toHaveLength(3)

    // The running job, once — not a second time from the generations page.
    expect(tiles[0]).toHaveTextContent("Generating")
    expect(tiles[0]).toHaveTextContent("62%")
    expect(tiles[0]).toHaveTextContent("@venkz on the rooftop, wind")
    expect(tiles[1]).toHaveTextContent("nano-banana-2 · 2m ago")
    expect(tiles[2]).toHaveTextContent("seedance-2.5 · 5m ago")
    expect(tiles[2]).toHaveTextContent("0:05")

    expect(
      within(strip).getByRole("link", { name: /all generations/i })
    ).toHaveAttribute("href", "/generations/")
  })

  it("opens a run's details and lineage when its tile is clicked", async () => {
    const user = userEvent.setup()
    mount(FULL)

    const strip = await screen.findByRole("region", { name: "Continue" })
    await user.click(
      await within(strip).findByRole("button", {
        name: /@mira in the hotel hallway, 35mm/,
      })
    )

    const sheet = await screen.findByRole("dialog")
    expect(
      (await within(sheet).findAllByText("google/nano-banana-2"))[0]
    ).toBeInTheDocument()
    expect(within(sheet).getByRole("tab", { name: "Lineage" })).toBeVisible()
    expectNothingSpent()
  })

  it("shows the cast as cards that go to each character's page", async () => {
    mount(FULL)

    const section = await screen.findByRole("region", { name: /characters/i })
    await waitFor(() =>
      expect(
        within(section).getByRole("heading", { name: /characters/i })
      ).toHaveTextContent(/Characters\s*2/)
    )
    const mira = within(section).getByRole("link", { name: /^mira/i })
    expect(mira).toHaveAttribute("href", "/container/?id=mira")
    await waitFor(() => expect(mira).toHaveTextContent("@mira · 12 assets"))
    expect(mira).toHaveTextContent("Sheet")
    expect(
      within(section).getByRole("link", { name: /^det\. ruiz/i })
    ).not.toHaveTextContent("Sheet")
    expect(
      within(section).getByRole("button", { name: /new character/i })
    ).toBeVisible()
    expect(
      within(section).getByRole("link", { name: /view all/i })
    ).toHaveAttribute("href", "/characters/")
  })

  it("shows scenes with how much is in them", async () => {
    mount(FULL)

    const section = await screen.findByRole("region", { name: /scenes/i })
    const hall = await within(section).findByRole("link", {
      name: /hotel hallway/i,
    })
    expect(hall).toHaveAttribute("href", "/container/?id=hall")
    await waitFor(() => expect(hall).toHaveTextContent("24 assets"))
  })

  it("lists what is generating now, with its progress", async () => {
    mount(FULL)

    const rail = await screen.findByRole("complementary", {
      name: /generating now/i,
    })
    expect(
      await within(rail).findByText("@venkz on the rooftop, wind")
    ).toBeVisible()
    expect(within(rail).getByText("62%")).toBeVisible()
  })

  it("names a new character before creating it, then goes to its page", async () => {
    const user = userEvent.setup()
    mount(EMPTY)

    await user.click(
      await screen.findByRole("button", {
        name: /create your first character/i,
      })
    )
    const dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByRole("textbox", { name: /name/i }),
      "Mira"
    )
    await user.click(within(dialog).getByRole("button", { name: /create/i }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:create", {
        name: "Mira",
        kind: "character",
        parentId: null,
      })
    )
    await waitFor(() => expect(pushed).toEqual(["/container/?id=made"]))
    expectNothingSpent()
  })

  it("creates from the New menu too", async () => {
    const user = userEvent.setup()
    mount(EMPTY)

    await user.click(await screen.findByRole("button", { name: /^new/i }))
    await user.click(await screen.findByRole("menuitem", { name: /scene/i }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/new scene/i)
  })
})
