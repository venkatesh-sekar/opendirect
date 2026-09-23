// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The family browser: every mapping in force, where it came from, what it
 * takes and where it runs; search and a source filter; and the actions a
 * row allows — only custom mappings can be edited or deleted, and a stored
 * mapping that no longer validates is listed first so it can be fixed or
 * removed by its storage key.
 *
 * ⛔ Every channel is stubbed; nothing here reaches a provider.
 */
import type {
  IpcChannel,
  RegistryFamilyEntry,
  UserOverride,
} from "@opendirect/contract"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { entry, family, override, renderWithProviders } from "./test-utils"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { FamilyList } = await import("./family-list")

const seedance = entry()
const nano = entry({
  family: family({
    id: "nano-banana-2",
    name: "Nano Banana 2",
    kind: "image",
    endpoints: [
      {
        provider: "openrouter",
        model: "google/gemini-3.1-flash-image",
        inputs: { reference: { field: "input_references", kind: "image" } },
        controls: {},
      },
    ],
  }),
  source: "remote",
  shadows: ["bundled"],
})
const mine = entry({
  family: family({
    id: "kling-v3-custom",
    name: "Kling 3 (mine)",
    endpoints: [
      {
        provider: "replicate",
        model: "kwaivgi/kling-v3",
        inputs: { character: { field: "elements", kind: "image" } },
        controls: {},
      },
    ],
  }),
  source: "user",
  warnings: ["endpoints.0: model not in the catalog"],
})
const mineStored = override({ key: "stored-7", family: mine.family })
const broken = override({
  key: "stored-9",
  id: "broken-one",
  raw: { id: "broken-one", name: "Broken" },
  family: null,
  issues: [
    { path: "kind", message: "Invalid option: expected video, image or audio" },
    { path: "endpoints", message: "Required" },
  ],
})

let data: { families: RegistryFamilyEntry[]; overrides: UserOverride[] }

beforeEach(() => {
  data = { families: [seedance, nano, mine], overrides: [mineStored, broken] }
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel) => {
    switch (channel) {
      case "registry:families":
        return data.families
      case "registry:overrides:list":
        return data.overrides
      case "registry:overrides:delete":
        return { ok: true }
      case "registry:overrides:export":
        return { path: "/tmp/kling.json" }
      case "registry:overrides:import":
        return { candidates: [] }
      default:
        return { ok: true }
    }
  })
})

afterEach(cleanup)

function row(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((li) => li.getAttribute("data-family-name") === name)
  if (!item) throw new Error(`no row for ${name}`)
  return item
}

describe("FamilyList", () => {
  it("badges each row with where its mapping came from", async () => {
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)

    await screen.findByText("Seedance 2.5")
    expect(within(row("Seedance 2.5")).getByText("Bundled")).toBeVisible()
    expect(within(row("Nano Banana 2")).getByText("Remote")).toBeVisible()
    expect(
      within(row("Nano Banana 2")).getByText("Overrides bundled")
    ).toBeVisible()
    expect(within(row("Kling 3 (mine)")).getByText("Custom")).toBeVisible()
  })

  it("shows the roles, the kind and where each family runs", async () => {
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)

    await screen.findByText("Seedance 2.5")
    const seed = row("Seedance 2.5")
    expect(within(seed).getByText("First frame")).toBeVisible()
    expect(within(seed).getByText("Last frame")).toBeVisible()
    expect(within(seed).getByText("Reference")).toBeVisible()
    expect(within(seed).getByText("Video")).toBeVisible()
    expect(seed).toHaveTextContent("Replicate · bytedance/seedance-2.5")
    expect(within(row("Kling 3 (mine)")).getByText("1 warning")).toBeVisible()
  })

  it("filters by name, provider and role as you type", async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)
    await screen.findByText("Seedance 2.5")
    const search = screen.getByRole("searchbox", { name: "Search mappings" })

    await user.type(search, "openrouter")
    expect(screen.queryByText("Seedance 2.5")).toBeNull()
    expect(screen.getByText("Nano Banana 2")).toBeVisible()

    await user.clear(search)
    await user.type(search, "character")
    expect(screen.getByText("Kling 3 (mine)")).toBeVisible()
    expect(screen.queryByText("Nano Banana 2")).toBeNull()

    await user.clear(search)
    await user.type(search, "zzz nothing")
    expect(screen.getByText(/No mappings match/)).toBeVisible()
    expect(screen.getByText(/New mapping/, { selector: "p" })).toBeVisible()
  })

  it("filters by source", async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)
    await screen.findByText("Seedance 2.5")

    await user.click(screen.getByRole("button", { name: /^Custom/ }))

    expect(screen.getByRole("button", { name: /^Custom/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.queryByText("Seedance 2.5")).toBeNull()
    expect(screen.getByText("Kling 3 (mine)")).toBeVisible()
  })

  it("offers Edit and Delete only on custom rows", async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)
    await screen.findByText("Seedance 2.5")

    await user.click(
      screen.getByRole("button", { name: "Actions for Seedance 2.5" })
    )
    let menu = await screen.findByRole("menu")
    expect(within(menu).queryByRole("menuitem", { name: /Delete/ })).toBeNull()
    expect(within(menu).queryByRole("menuitem", { name: /^Edit/ })).toBeNull()
    expect(
      within(menu).getByRole("menuitem", { name: /Duplicate as custom/ })
    ).toBeVisible()
    expect(
      within(menu).getByRole("menuitem", { name: /Export JSON/ })
    ).toBeVisible()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())

    await user.click(
      screen.getByRole("button", { name: "Actions for Kling 3 (mine)" })
    )
    menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: /Delete/ })).toBeVisible()
    expect(within(menu).getByRole("menuitem", { name: /^Edit/ })).toBeVisible()
  })

  it("asks before deleting a custom mapping, then deletes it by its key", async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)
    await screen.findByText("Seedance 2.5")

    await user.click(
      screen.getByRole("button", { name: "Actions for Kling 3 (mine)" })
    )
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }))

    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Delete Kling 3 (mine)?")
    expect(invoke).not.toHaveBeenCalledWith(
      "registry:overrides:delete",
      expect.anything()
    )

    await user.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("registry:overrides:delete", {
        key: "stored-7",
      })
    )
  })

  it("opens the editor on a copy when duplicating", async () => {
    const user = userEvent.setup()
    const onOpenEditor = vi.fn()
    renderWithProviders(<FamilyList onOpenEditor={onOpenEditor} />)
    await screen.findByText("Seedance 2.5")

    await user.click(
      screen.getByRole("button", { name: "Actions for Seedance 2.5" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: /Duplicate as custom/ })
    )

    expect(onOpenEditor).toHaveBeenCalledWith({
      from: expect.objectContaining({
        kind: "duplicate",
        source: seedance.family,
        family: expect.objectContaining({ id: "seedance-2-5-custom" }),
      }),
    })
  })

  it("lists an invalid stored mapping first, with its issue, Fix and Delete", async () => {
    const user = userEvent.setup()
    const onOpenEditor = vi.fn()
    renderWithProviders(<FamilyList onOpenEditor={onOpenEditor} />)

    const invalid = await screen.findByTestId("invalid-override")
    expect(invalid).toHaveTextContent("Custom mapping can't be used")
    expect(invalid).toHaveTextContent("broken-one")
    expect(invalid).toHaveTextContent(
      "kind: Invalid option: expected video, image or audio"
    )
    expect(invalid).toHaveTextContent("1 more issue")

    await user.click(within(invalid).getByRole("button", { name: /Fix/ }))
    expect(onOpenEditor).toHaveBeenCalledWith({
      from: { kind: "override", override: broken },
    })

    await user.click(within(invalid).getByRole("button", { name: /Delete/ }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("registry:overrides:delete", {
        key: "stored-9",
      })
    )
  })

  it("opens a blank editor from New mapping", async () => {
    const user = userEvent.setup()
    const onOpenEditor = vi.fn()
    renderWithProviders(<FamilyList onOpenEditor={onOpenEditor} />)
    await screen.findByText("Seedance 2.5")

    await user.click(screen.getByRole("button", { name: "New mapping" }))

    expect(onOpenEditor).toHaveBeenCalledWith({ from: { kind: "blank" } })
  })

  it("says so when there are no mappings at all", async () => {
    data = { families: [], overrides: [] }
    renderWithProviders(<FamilyList onOpenEditor={() => {}} />)

    expect(await screen.findByText(/No mappings yet/)).toBeVisible()
  })
})
