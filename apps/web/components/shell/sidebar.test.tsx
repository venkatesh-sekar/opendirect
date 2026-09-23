// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
import { DndContext } from "@dnd-kit/core"
import type {
  ContainerNodeDto,
  JobDto,
  ProjectRefDto,
} from "@opendirect/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

const pushed = vi.hoisted(() => [] as string[])
const location = vi.hoisted(() => ({ pathname: "/", search: "" }))

vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
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

const { ProjectSidebar } = await import("./sidebar")

const NOW = 1_767_225_600_000

const project: ProjectRefDto = {
  id: "project",
  name: "Infinite Hotel",
  path: "/tmp/hotel",
  createdAt: NOW,
}

function character(
  overrides: Partial<ContainerNodeDto> = {}
): ContainerNodeDto {
  return {
    id: "venkz",
    projectId: "project",
    name: "New character",
    kind: "character",
    parentId: null,
    position: 0,
    handle: "new-character",
    description: null,
    createdAt: NOW,
    children: [],
    ...overrides,
  }
}

function running(id: string, progress: number | null): JobDto {
  return {
    id,
    generationId: `gen-${id}`,
    state: "running",
    attempts: 1,
    error: null,
    createdAt: NOW,
    lastPolledAt: null,
    nextPollAt: null,
    awaitingResume: false,
    progress,
    generation: {
      id: `gen-${id}`,
      projectId: "project",
      containerId: null,
      provider: "replicate",
      modelSlug: "google/nano-banana",
      modelVersion: null,
      kind: "image",
      prompt: "@mira on the rooftop",
      paramsJson: "{}",
      requestJson: null,
      responseJson: null,
      status: "running",
      error: null,
      providerJobId: null,
      estimatedCostUsd: 0.42,
      actualCostUsd: null,
      predictTimeSeconds: null,
      costConfidence: "estimated",
      parentGenerationId: null,
      batchId: null,
      branchNote: null,
      createdAt: NOW,
      startedAt: NOW,
      completedAt: null,
    },
  }
}

/**
 * The tree main would return, mutable so a create can be followed by the
 * refetch the mutation triggers.
 */
let tree: ContainerNodeDto[] = []
let jobs: JobDto[] = []

function mount(initial: ContainerNodeDto[] = []) {
  tree = initial
  invoke.mockImplementation((channel: string, input: unknown) => {
    if (channel === "containers:tree") return Promise.resolve(tree)
    if (channel === "jobs:list") return Promise.resolve(jobs)
    if (channel === "generations:list")
      return Promise.resolve({
        items: [],
        total: 128,
        nextOffset: null,
        outputs: [],
      })
    if (channel === "containers:create") {
      const created = character({
        name: (input as { name: string }).name,
        kind: (input as { kind: ContainerNodeDto["kind"] }).kind,
      })
      tree = [created]
      return Promise.resolve(created)
    }
    return Promise.resolve(undefined)
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DndContext>
        <SidebarProvider>
          <ProjectSidebar project={project} onSwitchProject={() => {}} />
        </SidebarProvider>
      </DndContext>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  pushed.length = 0
  jobs = []
  location.pathname = "/"
  location.search = ""
})

describe("the sidebar's navigation", () => {
  it("names each place in the project, with how much is in it", async () => {
    mount([
      character({ id: "mira", name: "Mira", handle: "mira" }),
      character({ id: "ruiz", name: "Ruiz", handle: "ruiz" }),
      character({ id: "hall", name: "Hallway", kind: "scene", handle: "hall" }),
    ])

    const nav = await screen.findByRole("navigation", { name: /project/i })
    const link = (name: RegExp) => within(nav).getByRole("link", { name })

    expect(link(/^home/i)).toHaveAttribute("href", "/")
    expect(link(/^home/i)).toHaveAttribute("data-active")
    await waitFor(() =>
      expect(link(/^characters/i)).toHaveTextContent(/Characters\s*2/)
    )
    expect(link(/^characters/i)).toHaveAttribute("href", "/characters/")
    expect(link(/^scenes/i)).toHaveTextContent(/Scenes\s*1/)
    expect(link(/^scenes/i)).toHaveAttribute("href", "/scenes/")
    await waitFor(() =>
      expect(link(/^generations/i)).toHaveTextContent(/Generations\s*128/)
    )
    expect(link(/^generations/i)).toHaveAttribute("href", "/generations/")
    expect(link(/^canvas/i)).toHaveAttribute("href", "/canvas/")
  })

  /** A search box that only looks like one, until ⌘K is wired to it. */
  it("shows the search field without making it a working control yet", async () => {
    mount()
    await screen.findByText("Characters")
    expect(screen.getByText(/search or @mention/i)).toBeVisible()
    expect(screen.queryByRole("searchbox")).toBeNull()
  })

  /**
   * A row used to open the library dialog. It is a place now: clicking it
   * goes to the container's page, and a drop onto it still files the asset.
   */
  it("navigates to a character's page when its row is clicked", async () => {
    mount([character({ id: "mira", name: "Mira", handle: "mira" })])

    // A plain click: the test's `DndContext` has no activation distance, so a
    // pointer-driven click would be taken for the start of a drag.
    fireEvent.click(await screen.findByRole("button", { name: /^mira/i }))

    expect(pushed).toEqual(["/container/?id=mira"])
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("marks the row of the container whose page is open", async () => {
    location.pathname = "/container/"
    location.search = "?id=ruiz"
    mount([
      character({ id: "mira", name: "Mira", handle: "mira" }),
      character({ id: "ruiz", name: "Ruiz", handle: "ruiz" }),
    ])

    const row = (name: RegExp) =>
      screen
        .getByRole("button", { name })
        .closest('[role="treeitem"]') as HTMLElement
    await screen.findByRole("button", { name: /^ruiz/i })
    expect(row(/^ruiz/i)).toHaveAttribute("aria-selected", "true")
    expect(row(/^mira/i)).toHaveAttribute("aria-selected", "false")
    // Home is not the page that is open.
    expect(screen.getByRole("link", { name: /^home/i })).not.toHaveAttribute(
      "data-active"
    )
  })

  it("lists folders under their own heading, and navigates to them too", async () => {
    mount([
      character({
        id: "moods",
        name: "Moodboards",
        kind: "folder",
        handle: null,
      }),
    ])

    const folders = await screen.findByRole("group", { name: "Folders" })
    fireEvent.click(
      await within(folders).findByRole("button", { name: /^moodboards/i })
    )
    expect(pushed).toEqual(["/container/?id=moods"])
  })

  it("shows what is generating, and what it is expected to cost", async () => {
    jobs = [running("a", 0.5), running("b", 0.25)]
    mount()

    const card = await screen.findByRole("status", { name: /generating/i })
    expect(card).toHaveTextContent("2 generating")
    expect(card).toHaveTextContent("$0.84")
  })

  it("says nothing about generating when nothing is", async () => {
    mount()
    await screen.findByText("Characters")
    expect(screen.queryByRole("status", { name: /generating/i })).toBeNull()
  })
})

describe("creating from the sidebar", () => {
  /**
   * "Untitled" was the old name, and three of them are three handles nobody
   * would ever type. The "+" now has to leave something nameable behind.
   */
  it("creates a placeholder-named character and opens its rename field", async () => {
    const user = userEvent.setup()
    mount()

    await screen.findByText("Characters")
    await user.click(screen.getByRole("button", { name: "New character" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:create", {
        name: "New character",
        kind: "character",
        parentId: null,
      })
    )

    const field = await screen.findByRole("textbox", { name: /rename/i })
    expect(field).toHaveFocus()
    expect(field).toHaveValue("New character")
  })

  it("renames on Enter, which is what derives the handle", async () => {
    const user = userEvent.setup()
    mount()

    await screen.findByText("Characters")
    await user.click(screen.getByRole("button", { name: "New character" }))
    // The field opens focused with its placeholder selected, so the first
    // keystroke replaces it — no clearing, no clicking.
    await screen.findByRole("textbox", { name: /rename/i })
    await user.keyboard("Venkz{Enter}")

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:rename", {
        id: "venkz",
        name: "Venkz",
      })
    )
  })

  it("removes the container again when the rename is escaped untouched", async () => {
    const user = userEvent.setup()
    mount()

    await screen.findByText("Scenes")
    await user.click(screen.getByRole("button", { name: "New scene" }))
    const field = await screen.findByRole("textbox", { name: /rename/i })

    await user.keyboard("{Escape}")
    expect(field).not.toBeInTheDocument()

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:delete", { id: "venkz" })
    )
  })
})
