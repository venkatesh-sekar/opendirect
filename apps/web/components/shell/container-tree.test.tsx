// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { DndContext } from "@dnd-kit/core"
import type { ContainerNodeDto } from "@opendirect/contract"
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

const { ContainerTree } = await import("./container-tree")

const node: ContainerNodeDto = {
  id: "shelf",
  projectId: "project",
  name: "Wardrobe",
  kind: "folder",
  parentId: null,
  position: 0,
  handle: null,
  description: null,
  createdAt: 1767225600000,
  children: [],
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DndContext>
        <SidebarProvider>
          <ContainerTree nodes={[node]} selectedId={null} onSelect={() => {}} />
        </SidebarProvider>
      </DndContext>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("container delete", () => {
  /**
   * The delete cascades to sub-containers and nothing undoes it, so the
   * right-click must not be the last word — it used to fire the mutation on
   * the spot.
   */
  it("asks before deleting, and deletes nothing until the answer is yes", async () => {
    const user = userEvent.setup()
    mount()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByTestId("container-row"),
    })
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }))

    // The dialog is up, and it says what survives.
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(/Wardrobe/)
    expect(dialog).toHaveTextContent(/Assets stay in the project/i)
    expect(invoke).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /keep it/i }))
    expect(invoke).not.toHaveBeenCalled()
  })

  it("deletes once the confirmation is answered", async () => {
    invoke.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    mount()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByTestId("container-row"),
    })
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }))
    await user.click(await screen.findByRole("button", { name: /^delete$/i }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:delete", { id: "shelf" })
    )
  })
})

/** A character: the kind that has a handle and can be `@`-mentioned. */
const venkz: ContainerNodeDto = {
  ...node,
  id: "venkz",
  name: "Venkz",
  kind: "character",
  handle: "venkz",
}

function mountCharacter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DndContext>
        <SidebarProvider>
          <ContainerTree
            nodes={[venkz]}
            selectedId={null}
            onSelect={() => {}}
          />
        </SidebarProvider>
      </DndContext>
    </QueryClientProvider>
  )
}

describe("a mentionable row", () => {
  /** The dimmed handle is the affordance that says "this one is @-able". */
  it("shows the handle beside the name", () => {
    mountCharacter()
    expect(screen.getByTestId("container-handle")).toHaveTextContent("@venkz")
  })

  it("has no handle to show on a folder", () => {
    mount()
    expect(screen.queryByTestId("container-handle")).not.toBeInTheDocument()
  })

  it("opens the rename field on a double click", async () => {
    const user = userEvent.setup()
    mountCharacter()
    await user.dblClick(screen.getByText("Venkz"))
    expect(await screen.findByRole("textbox", { name: /rename/i })).toHaveValue(
      "Venkz"
    )
  })

  it("edits the handle and the description from the context menu", async () => {
    invoke.mockResolvedValue({ ...venkz, handle: "v" })
    const user = userEvent.setup()
    mountCharacter()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByTestId("container-row"),
    })
    await user.click(
      await screen.findByRole("menuitem", { name: /edit handle/i })
    )

    const field = await screen.findByLabelText("Handle")
    expect(field).toHaveValue("venkz")
    await user.clear(field)
    await user.type(field, "v")
    await user.type(await screen.findByLabelText("Description"), "A tall man")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:setHandle", {
        id: "venkz",
        handle: "v",
      })
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:setDescription", {
        id: "venkz",
        description: "A tall man",
      })
    )
  })

  it("refuses to send a handle the pattern rejects", async () => {
    const user = userEvent.setup()
    mountCharacter()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByTestId("container-row"),
    })
    await user.click(
      await screen.findByRole("menuitem", { name: /edit handle/i })
    )

    const field = await screen.findByLabelText("Handle")
    await user.clear(field)
    await user.type(field, "Venkz!")

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("offers neither on a folder", async () => {
    const user = userEvent.setup()
    mount()
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByTestId("container-row"),
    })
    await screen.findByRole("menuitem", { name: /rename/i })
    expect(
      screen.queryByRole("menuitem", { name: /edit handle/i })
    ).not.toBeInTheDocument()
  })
})
