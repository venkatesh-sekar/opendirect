// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { asset, container, generation, job, summary } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/container/",
  useRouter: () => ({ push: () => {}, replace }),
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

const { ContainerScreen } = await import("./container-screen")
const { forgetFilingContainer, lastFilingContainer } =
  await import("@/lib/canvas/filing")

const SHEET = asset({ id: "sheet", label: "Sheet" })
const SIDE = asset({ id: "side", label: "Side view" })
const MADE = asset({ id: "made", label: "Rooftop", generationId: "g-done" })
const UPLOAD = asset({ id: "upload", label: "Upload" })
const ASSETS = [SHEET, SIDE, MADE, UPLOAD]

function responses(): Record<string, unknown> {
  return {
    "containers:tree": [
      container({
        id: "mira",
        name: "Mira",
        handle: "mira",
        description: "Night-shift concierge",
        referenceAssetIds: ["sheet", "side"],
      }),
      container({ id: "moods", name: "Moodboards", kind: "folder" }),
      container({ id: "hall", name: "Hotel hallway", kind: "scene" }),
    ],
    "containers:summaries": [
      summary({ id: "mira", assetCount: 12, generationCount: 38 }),
    ],
    "assets:list": { items: ASSETS, total: ASSETS.length, nextOffset: null },
    "jobs:list": [
      job({
        generation: generation({
          id: "g-run",
          status: "running",
          containerId: "mira",
          prompt: "@mira running now",
        }),
        generationId: "g-run",
      }),
    ],
    "generations:list": {
      items: [
        generation({
          id: "g-done",
          containerId: "mira",
          prompt: "@mira on the roof",
        }),
      ],
      outputs: [MADE],
      total: 1,
      nextOffset: null,
    },
    "containers:setReferences": container({ id: "mira" }),
    "containers:rename": container({ id: "mira" }),
    "containers:setHandle": container({ id: "mira" }),
    "containers:setDescription": container({ id: "mira" }),
    "assets:choose": { paths: ["/tmp/new.png"] },
    "assets:import": { assets: [asset({ id: "new" })], failures: [] },
    "settings:get": { defaultImageModel: null, defaultVideoModel: null },
    "mentions:subjects": [],
    "models:list": { models: [], failures: [] },
    "models:recommended": { video: [], image: [] },
  }
}

function mount(id: string | null, tab: string | null = null) {
  const table = responses()
  invoke.mockImplementation((channel: string, payload?: { id?: string }) => {
    if (channel === "assets:get") {
      const found = ASSETS.find((one) => one.id === payload?.id)
      return found ? Promise.resolve(found) : Promise.reject(new Error("gone"))
    }
    return channel in table
      ? Promise.resolve(table[channel])
      : new Promise(() => {})
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ContainerScreen id={id} tab={tab} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function calls(channel: string) {
  return invoke.mock.calls.filter(([name]) => name === channel)
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  replace.mockReset()
  forgetFilingContainer()
})

describe("a character's page", () => {
  it("names the character, what is in it and how to generate with it", async () => {
    mount("mira")

    // The loading frame's top bar is replaced by the page's own.
    await screen.findByRole("heading", { level: 2, name: "Mira" })
    const bar = screen.getByRole("banner")
    expect(
      within(bar).getByRole("link", { name: "Characters" })
    ).toHaveAttribute("href", "/characters/")
    expect(within(bar).getByText("Mira")).toBeVisible()
    expect(
      within(bar).getByRole("button", { name: "Generate with @mira" })
    ).toBeVisible()

    const main = screen.getByRole("main")
    expect(
      within(main).getByRole("heading", { level: 2, name: "Mira" })
    ).toBeVisible()
    expect(within(main).getByText("@mira")).toBeVisible()
    expect(within(main).getByText("Night-shift concierge")).toBeVisible()
    expect(
      await within(main).findByText("12 assets · 38 generations")
    ).toBeVisible()
  })

  it("shows the references sent to the model, numbered in order", async () => {
    mount("mira")

    const strip = await screen.findByRole("list", {
      name: /references sent to the model/i,
    })
    const items = await within(strip).findAllByRole("listitem")
    expect(items.map((item) => item.dataset.assetId)).toEqual(["sheet", "side"])
    expect(within(items[0]!).getByText("1")).toBeVisible()
    expect(within(items[1]!).getByText("2")).toBeVisible()
    expect(screen.getByRole("button", { name: /add reference/i })).toBeVisible()
  })

  it("takes a reference out from the strip", async () => {
    const user = userEvent.setup()
    mount("mira")

    const strip = await screen.findByRole("list", {
      name: /references sent to the model/i,
    })
    await user.click(
      await within(strip).findByRole("button", {
        name: "Remove Sheet from references",
      })
    )
    await waitFor(() =>
      expect(calls("containers:setReferences")).toHaveLength(1)
    )
    expect(calls("containers:setReferences")[0]![1]).toEqual({
      id: "mira",
      assetIds: ["side"],
    })
  })

  it("links its tabs through the query string, and Canvas away to the canvas", async () => {
    mount("mira")

    const tabs = await screen.findByRole("navigation", { name: /sections/i })
    expect(within(tabs).getByRole("link", { name: /assets/i })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(
      within(tabs).getByRole("link", { name: /generations/i })
    ).toHaveAttribute("href", "/container/?id=mira&tab=generations")
    expect(within(tabs).getByRole("link", { name: /canvas/i })).toHaveAttribute(
      "href",
      "/canvas/?focus=mira"
    )
    // §8: no canvas is ever embedded in a container's page.
    expect(document.querySelector(".react-flow")).toBeNull()
  })

  it("filters its assets by chip", async () => {
    const user = userEvent.setup()
    mount("mira")

    const grid = await screen.findByRole("list", { name: /assets/i })
    await waitFor(() =>
      expect(within(grid).getAllByRole("listitem")).toHaveLength(4)
    )

    await user.click(screen.getByRole("button", { name: "Generated" }))
    expect(
      within(grid)
        .getAllByRole("listitem")
        .map((item) => item.dataset.assetId)
    ).toEqual(["made"])

    await user.click(screen.getByRole("button", { name: "References" }))
    expect(
      within(grid)
        .getAllByRole("listitem")
        .map((item) => item.dataset.assetId)
    ).toEqual(["sheet", "side"])
  })

  it("adds an asset to the end of the references from the grid", async () => {
    const user = userEvent.setup()
    mount("mira")

    await user.click(
      await screen.findByRole("button", { name: "Use Upload as a reference" })
    )
    await waitFor(() =>
      expect(calls("containers:setReferences")).toHaveLength(1)
    )
    expect(calls("containers:setReferences")[0]![1]).toEqual({
      id: "mira",
      assetIds: ["sheet", "side", "upload"],
    })
  })

  /**
   * Main as it really behaves: a write lands at once, and the tree that
   * reflects it arrives a moment later. A page that unlocks its controls in
   * between, or reads the stale tree, loses the first of two quick edits.
   */
  function slowTree() {
    const answer = invoke.getMockImplementation()!
    let references = ["sheet", "side"]
    invoke.mockImplementation(
      (channel: string, payload?: { assetIds?: string[] | null }) => {
        if (channel === "containers:setReferences") {
          references = payload?.assetIds ?? []
          return Promise.resolve(container({ id: "mira" }))
        }
        if (channel === "containers:tree") {
          const tree = (
            responses()["containers:tree"] as ReturnType<typeof container>[]
          ).map((node) =>
            node.id === "mira"
              ? { ...node, referenceAssetIds: [...references] }
              : node
          )
          return new Promise((resolve) => setTimeout(() => resolve(tree), 60))
        }
        return answer(channel, payload)
      }
    )
    return () => references
  }

  it("keeps both of two quick reference edits", async () => {
    const user = userEvent.setup()
    mount("mira")
    const saved = slowTree()

    await user.click(
      await screen.findByRole("button", { name: "Use Upload as a reference" })
    )
    const next = await screen.findByRole("button", {
      name: "Use Rooftop as a reference",
    })
    await waitFor(() => expect(next).toBeEnabled())
    await user.click(next)

    await waitFor(() =>
      expect(calls("containers:setReferences")).toHaveLength(2)
    )
    expect(calls("containers:setReferences")[1]![1]).toEqual({
      id: "mira",
      assetIds: ["sheet", "side", "upload", "made"],
    })
    expect(saved()).toEqual(["sheet", "side", "upload", "made"])
  })

  it("reorders the references by dragging one onto another's place", async () => {
    const user = userEvent.setup()
    mount("mira")
    slowTree()

    const strip = await screen.findByRole("list", {
      name: /references sent to the model/i,
    })
    await within(strip).findAllByRole("listitem")
    // jsdom lays nothing out; give each thumbnail its place in the row.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const item = this.closest("li[data-asset-id]")
        const index = item
          ? ["sheet", "side"].indexOf(item.getAttribute("data-asset-id")!)
          : -1
        const left = index < 0 ? 0 : index * 72
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          width: 64,
          height: 80,
          right: left + 64,
          bottom: 80,
          toJSON: () => ({}),
        } as DOMRect
      })

    try {
      within(strip)
        .getByRole("button", { name: /reference 1: sheet/i })
        .focus()
      await user.keyboard(" ")
      await user.keyboard("{ArrowRight}")
      await user.keyboard(" ")

      await waitFor(() =>
        expect(calls("containers:setReferences")).toHaveLength(1)
      )
      expect(calls("containers:setReferences")[0]![1]).toEqual({
        id: "mira",
        assetIds: ["side", "sheet"],
      })
      // The new order shows at once, not after the tree comes back.
      expect(
        within(strip)
          .getAllByRole("listitem")
          .map((item) => item.dataset.assetId)
      ).toEqual(["side", "sheet"])
    } finally {
      rect.mockRestore()
    }
  })

  it("puts the references back when main refuses the change", async () => {
    const user = userEvent.setup()
    mount("mira")
    const answer = invoke.getMockImplementation()!
    invoke.mockImplementation((channel: string, payload?: unknown) =>
      channel === "containers:setReferences"
        ? Promise.reject(new Error("That asset is not in Mira"))
        : answer(channel, payload)
    )

    const strip = await screen.findByRole("list", {
      name: /references sent to the model/i,
    })
    await user.click(
      await within(strip).findByRole("button", {
        name: "Remove Sheet from references",
      })
    )
    await waitFor(() =>
      expect(calls("containers:setReferences")).toHaveLength(1)
    )
    await waitFor(() =>
      expect(
        within(strip)
          .getAllByRole("listitem")
          .map((item) => item.dataset.assetId)
      ).toEqual(["sheet", "side"])
    )
  })

  it("imports into itself", async () => {
    const user = userEvent.setup()
    mount("mira")

    await user.click(await screen.findByRole("button", { name: /import/i }))
    await waitFor(() => expect(calls("assets:import")).toHaveLength(1))
    expect(calls("assets:import")[0]![1]).toEqual({
      paths: ["/tmp/new.png"],
      containerId: "mira",
    })
  })

  it("edits its name and handle in place, saving only what changed", async () => {
    const user = userEvent.setup()
    mount("mira")

    await user.click(await screen.findByRole("button", { name: "Edit" }))
    const name = screen.getByLabelText("Name")
    await user.clear(name)
    await user.type(name, "Mira Vance")
    await user.clear(screen.getByLabelText("Handle"))
    await user.type(screen.getByLabelText("Handle"), "mira-v")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull())
    expect(calls("containers:rename")[0]![1]).toEqual({
      id: "mira",
      name: "Mira Vance",
    })
    expect(calls("containers:setHandle")[0]![1]).toEqual({
      id: "mira",
      handle: "mira-v",
    })
    expect(calls("containers:setDescription")).toHaveLength(0)
  })

  it("keeps the form open with main's reason when a handle is refused", async () => {
    const user = userEvent.setup()
    mount("mira")
    const answer = invoke.getMockImplementation()!
    invoke.mockImplementation((channel: string, payload?: unknown) =>
      channel === "containers:setHandle"
        ? Promise.reject(new Error("@venkz is already taken"))
        : answer(channel, payload)
    )

    await user.click(await screen.findByRole("button", { name: "Edit" }))
    await user.clear(screen.getByLabelText("Handle"))
    await user.type(screen.getByLabelText("Handle"), "venkz")
    await user.type(screen.getByLabelText("Description"), " who never sleeps")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "@venkz is already taken"
    )
    expect(screen.getByLabelText("Handle")).toBeVisible()
    // Nothing after the refusal is half-saved.
    expect(calls("containers:setDescription")).toHaveLength(0)
  })

  it("opens the generate panel without spending anything", async () => {
    const user = userEvent.setup()
    mount("mira")

    await user.click(
      await screen.findByRole("button", { name: "Generate with @mira" })
    )
    expect(
      await screen.findByRole("complementary", { name: "Generate with @mira" })
    ).toBeVisible()
    expect(screen.getByLabelText("Prompt")).toHaveValue("@mira ")
    expect(calls("generations:submitBatch")).toHaveLength(0)
    expect(calls("generations:submit")).toHaveLength(0)
  })

  it("lists its own runs on the Generations tab, running first", async () => {
    mount("mira", "generations")

    const running = await screen.findByRole("region", { name: "Running" })
    expect(within(running).getByText("@mira running now")).toBeVisible()
    expect(await screen.findByText("@mira on the roof")).toBeVisible()
    expect(calls("generations:list")[0]![1]).toMatchObject({
      containerId: "mira",
    })
  })

  /** The canvas files new nodes under the container last visited. */
  it("becomes where the canvas files new nodes", async () => {
    mount("mira")
    await screen.findByRole("banner")
    await waitFor(() => expect(lastFilingContainer()).toBe("mira"))
  })
})

describe("a folder's page", () => {
  it("is its assets, with no references and nothing to generate", async () => {
    mount("moods")

    expect(
      await screen.findByRole("heading", { level: 2, name: "Moodboards" })
    ).toBeVisible()
    expect(await screen.findByRole("list", { name: /assets/i })).toBeVisible()
    expect(screen.getByRole("button", { name: /import/i })).toBeVisible()
    expect(screen.queryByRole("button", { name: /^generate /i })).toBeNull()
    expect(screen.queryByRole("list", { name: /references sent/i })).toBeNull()
    expect(screen.getByRole("link", { name: /open canvas/i })).toHaveAttribute(
      "href",
      "/canvas/?focus=moods"
    )
  })
})

describe("a scene's page", () => {
  it("generates in the scene and opens on its generations", async () => {
    mount("hall")

    await screen.findByRole("heading", { level: 2, name: "Hotel hallway" })
    const bar = screen.getByRole("banner")
    expect(within(bar).getByRole("link", { name: "Scenes" })).toHaveAttribute(
      "href",
      "/scenes/"
    )
    expect(
      within(bar).getByRole("button", { name: "Generate in scene" })
    ).toBeVisible()
    const tabs = screen.getByRole("navigation", { name: /sections/i })
    expect(
      within(tabs).getByRole("link", { name: /generations/i })
    ).toHaveAttribute("aria-current", "page")
  })
})

describe("a container that is not there", () => {
  it("says so, and is not remembered", async () => {
    mount("nope")
    expect(await screen.findByText(/no longer exists/i)).toBeVisible()
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/"
    )
    expect(lastFilingContainer()).toBeNull()
  })
})
