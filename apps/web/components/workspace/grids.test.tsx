// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { asset, container, generation, job, summary } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {} }),
}))

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

const { CharactersScreen, GenerationsScreen, ScenesScreen } =
  await import("./grids")

const HOUR = 3_600_000

function mount(ui: ReactNode, responses: Record<string, unknown>) {
  invoke.mockImplementation((channel: string, input: unknown) => {
    if (channel === "generations:list") {
      // Pages the way main does: `offset` in, `nextOffset` out.
      const page = responses[channel] as { items: unknown[]; outputs: [] }
      const { limit = 40, offset = 0 } = (input ?? {}) as {
        limit?: number
        offset?: number
      }
      const items = page.items.slice(offset, offset + limit)
      const next = offset + items.length
      return Promise.resolve({
        items,
        total: page.items.length,
        nextOffset: next < page.items.length ? next : null,
        outputs: page.outputs,
      })
    }
    return channel in responses
      ? Promise.resolve(responses[channel])
      : new Promise(() => {})
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

const TREE = [
  container({ id: "mira", name: "Mira", handle: "mira" }),
  container({
    id: "folder",
    name: "Cast B",
    kind: "folder",
    children: [
      container({
        id: "tao",
        name: "Old Tao",
        handle: "tao",
        parentId: "folder",
      }),
    ],
  }),
  container({ id: "hall", name: "Hotel hallway", kind: "scene" }),
]

describe("the Characters page", () => {
  it("shows every character, including ones filed in a folder", async () => {
    mount(<CharactersScreen />, {
      "containers:tree": TREE,
      "containers:summaries": [summary({ id: "tao", assetCount: 7 })],
    })

    const main = await screen.findByRole("main")
    expect(
      await within(main).findByRole("heading", { name: /characters/i })
    ).toHaveTextContent(/Characters\s*2/)
    expect(within(main).getByRole("link", { name: /^mira/i })).toBeVisible()
    expect(
      within(main).getByRole("link", { name: /^old tao/i })
    ).toHaveAttribute("href", "/container/?id=tao")
    expect(within(main).queryByText("Hotel hallway")).toBeNull()
  })
})

describe("the Scenes page", () => {
  it("shows every scene and a way to make another", async () => {
    mount(<ScenesScreen />, {
      "containers:tree": TREE,
      "containers:summaries": [],
    })

    const main = await screen.findByRole("main")
    expect(
      await within(main).findByRole("link", { name: /hotel hallway/i })
    ).toHaveAttribute("href", "/container/?id=hall")
    // In the top bar, and as the dashed card at the end of the grid.
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: /new scene/i,
      })
    ).toBeVisible()
    expect(
      within(main).getAllByRole("button", { name: /new scene/i })
    ).toHaveLength(2)
  })
})

describe("the Generations page", () => {
  const now = Date.now()
  const runs = [
    generation({ id: "a", prompt: "today's take", createdAt: now - 60_000 }),
    generation({
      id: "b",
      prompt: "an old take",
      createdAt: now - 80 * HOUR,
    }),
  ]

  it("lists running jobs first, then every run grouped by day", async () => {
    mount(<GenerationsScreen />, {
      "jobs:list": [job()],
      "generations:list": {
        items: runs,
        total: 2,
        nextOffset: null,
        outputs: [asset({ generationId: "a" })],
      },
    })

    const groups = await screen.findAllByRole("region")
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Running",
      "Today",
      expect.any(String),
    ])
    expect(
      within(groups[0]!).getByText("@venkz on the rooftop, wind")
    ).toBeVisible()
    expect(within(groups[1]!).getByText("today's take")).toBeVisible()
    expect(within(groups[2]!).getByText("an old take")).toBeVisible()
  })

  /**
   * Paged by offset, not by a growing limit: `generations:list` refuses more
   * than 500 in one call, and a project's history does not stop there.
   */
  it("pages further back by offset, past what one call can return", async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 560 }, (_, index) =>
      generation({
        id: `g${index}`,
        prompt: `take ${index}`,
        createdAt: now - index * 1000,
      })
    )
    mount(<GenerationsScreen />, {
      "jobs:list": [],
      "generations:list": { items: many, outputs: [] },
    })

    await screen.findByText("take 0")
    expect(screen.queryByText("take 65")).toBeNull()
    await user.click(screen.getByRole("button", { name: /show more/i }))
    expect(await screen.findByText("take 65")).toBeVisible()
    expect(invoke).toHaveBeenCalledWith("generations:list", {
      limit: 60,
      offset: 60,
    })

    for (let page = 2; page < 10; page++) {
      await user.click(screen.getByRole("button", { name: /show more/i }))
      await screen.findByText(`take ${page * 60}`)
    }
    expect(await screen.findByText("take 559")).toBeVisible()
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull()
    // Ten pages of real tiles in jsdom: slow, not stuck.
  }, 30_000)

  it("says so when the project has no runs yet", async () => {
    mount(<GenerationsScreen />, {
      "jobs:list": [],
      "generations:list": {
        items: [],
        total: 0,
        nextOffset: null,
        outputs: [],
      },
    })
    expect(await screen.findByText(/nothing generated yet/i)).toBeVisible()
  })
})
