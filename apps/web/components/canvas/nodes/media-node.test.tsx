// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { AssetDto, CanvasNodeDto } from "@opendirect/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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

const { MediaNodeBody } = await import("./media-node")
const { defaultContainerName } =
  await import("@/components/board/save-as-container")

const NOW = 1_767_225_600_000

const asset: AssetDto = {
  id: "asset-1",
  projectId: "project",
  kind: "image",
  label: null,
  originalName: "venkz-sheet-v3.png",
  relPath: "assets/2026/09/venkz-sheet-v3.png",
  mimeType: "image/png",
  thumbnailRelPath: null,
  url: "media://venkz-sheet-v3.png",
  thumbnailUrl: null,
  text: null,
  width: 1024,
  height: 1024,
  durationMs: null,
  bytes: 1024,
  sha256: "abc",
  generationId: null,
  pinned: false,
  createdAt: NOW,
}

const node = {
  id: "node-1",
  asset,
} as unknown as CanvasNodeDto

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MediaNodeBody node={node} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("defaultContainerName", () => {
  it("proposes the file's own name without its extension or separators", () => {
    expect(defaultContainerName(asset)).toBe("venkz sheet v3")
  })

  it("prefers the label the user gave it", () => {
    expect(defaultContainerName({ ...asset, label: "Venkz" })).toBe("Venkz")
  })
})

describe("save as character", () => {
  /**
   * ⛔ One channel, one transaction, nothing generated: the container, the
   * link and the reference image.
   */
  it("creates the character from the asset the node holds", async () => {
    invoke.mockResolvedValue({ id: "c1", handle: "venkz" })
    const user = userEvent.setup()
    mount()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("img", { name: /venkz-sheet-v3/ }),
    })
    await user.click(
      await screen.findByRole("menuitem", { name: /save as character/i })
    )

    const name = await screen.findByLabelText("Name")
    expect(name).toHaveValue("venkz sheet v3")
    // The handle it will answer to, derived by the contract's own slugifier.
    expect(screen.getByTestId("save-as-handle")).toHaveTextContent(
      "@venkz-sheet-v3"
    )

    await user.clear(name)
    await user.type(name, "Venkz")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:createFromAsset", {
        assetId: "asset-1",
        kind: "character",
        name: "Venkz",
      })
    )
  })

  it("saves a scene the same way", async () => {
    invoke.mockResolvedValue({ id: "c2", handle: "lobby" })
    const user = userEvent.setup()
    mount()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("img", { name: /venkz-sheet-v3/ }),
    })
    await user.click(
      await screen.findByRole("menuitem", { name: /save as scene/i })
    )
    await user.click(await screen.findByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("containers:createFromAsset", {
        assetId: "asset-1",
        kind: "scene",
        name: "venkz sheet v3",
      })
    )
  })

  it("does nothing until Save is pressed", async () => {
    const user = userEvent.setup()
    mount()

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("img", { name: /venkz-sheet-v3/ }),
    })
    await user.click(
      await screen.findByRole("menuitem", { name: /save as character/i })
    )
    await screen.findByLabelText("Name")
    await user.click(screen.getByRole("button", { name: /cancel/i }))

    expect(invoke).not.toHaveBeenCalled()
  })
})
