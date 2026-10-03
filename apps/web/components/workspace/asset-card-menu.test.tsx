// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { CropIcon } from "@hugeicons/core-free-icons"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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

import { asset, container } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

const { AssetLibrary } = await import("./asset-library")
const { assetCardActions } = await import("./asset-card-menu")

const SHEET = asset({ id: "sheet", label: "Sheet" })
const SIDE = asset({ id: "side", label: "Side view" })
const MIRA = container({
  id: "mira",
  name: "Mira",
  handle: "mira",
  referenceAssetIds: ["sheet"],
})

function mount() {
  const table: Record<string, unknown> = {
    "assets:list": { items: [SHEET, SIDE], total: 2, nextOffset: null },
    "containers:tree": [
      MIRA,
      container({ id: "hall", name: "Hotel hallway", kind: "scene" }),
      container({ id: "moods", name: "Moodboards", kind: "folder" }),
    ],
    "assets:move": { ok: true },
    "assets:delete": { ok: true },
  }
  invoke.mockImplementation((channel: string) =>
    channel in table ? Promise.resolve(table[channel]) : new Promise(() => {})
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AssetLibrary node={MIRA} onToggleReference={() => {}} />
    </QueryClientProvider>
  )
}

function calls(channel: string) {
  return invoke.mock.calls.filter(([name]) => name === channel)
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("assetCardActions", () => {
  it("lists Move, any edits, then Delete last and marked destructive", () => {
    const actions = assetCardActions({
      onMove: () => {},
      onDelete: () => {},
      edits: [{ id: "crop", label: "Crop…", icon: CropIcon, run: () => {} }],
    })
    expect(actions.map((action) => action.id)).toEqual([
      "move",
      "crop",
      "delete",
    ])
    expect(actions.at(-1)!.destructive).toBe(true)
  })
})

describe("a card's menu in the asset grid", () => {
  it("asks before deleting, and deletes only on yes", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(
      await screen.findByRole("button", { name: "More actions for Sheet" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete “Sheet”?")).toBeVisible()
    expect(calls("assets:delete")).toEqual([])

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(calls("assets:delete")).toHaveLength(1))
    expect(calls("assets:delete")[0]![1]).toEqual({ id: "sheet" })
  })

  it("keeps the asset when the delete is cancelled", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(
      await screen.findByRole("button", { name: "More actions for Side view" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Keep it",
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    expect(calls("assets:delete")).toEqual([])
  })

  it("moves to another container, never offering the one it is in", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(
      await screen.findByRole("button", { name: "More actions for Sheet" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /move to/i }))

    const dialog = await screen.findByRole("dialog")
    const hall = await within(dialog).findByRole("option", {
      name: /hotel hallway/i,
    })
    expect(
      within(dialog).queryByRole("option", { name: /^mira/i })
    ).not.toBeInTheDocument()

    await user.click(hall)
    await waitFor(() => expect(calls("assets:move")).toHaveLength(1))
    expect(calls("assets:move")[0]![1]).toEqual({
      assetId: "sheet",
      fromContainerId: "mira",
      toContainerId: "hall",
    })
  })

  it("offers the same actions on right-click", async () => {
    mount()

    const card = (await screen.findByRole("button", { name: "Preview Sheet" }))
      .parentElement!
    // The trigger *is* the grid's list item — wrapping adds no element, and
    // the hover group the ⋯ button keys off is still on it.
    expect(card.tagName).toBe("LI")
    expect(card).toHaveClass("group")
    expect(card.dataset.assetId).toBe("sheet")
    fireEvent.contextMenu(card)

    expect(
      await screen.findByRole("menuitem", { name: /move to/i })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeVisible()
  })

  it("never reaches a generation channel", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(
      await screen.findByRole("button", { name: "More actions for Sheet" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      })
    )
    await waitFor(() => expect(calls("assets:delete")).toHaveLength(1))
    expect(
      invoke.mock.calls.filter(([name]) =>
        String(name).startsWith("generations:")
      )
    ).toEqual([])
  })
})
