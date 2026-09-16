// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
import { DndContext } from "@dnd-kit/core"
import type { ContainerNodeDto, ProjectRefDto } from "@opendirect/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

// `next/link` wants the App Router's context, which no unit test mounts.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
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

/**
 * The tree main would return, mutable so a create can be followed by the
 * refetch the mutation triggers.
 */
let tree: ContainerNodeDto[] = []

function mount() {
  tree = []
  invoke.mockImplementation((channel: string, input: unknown) => {
    if (channel === "containers:tree") return Promise.resolve(tree)
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
          <ProjectSidebar
            project={project}
            selectedContainerId={null}
            onSelectContainer={() => {}}
            onSwitchProject={() => {}}
          />
        </SidebarProvider>
      </DndContext>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
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
