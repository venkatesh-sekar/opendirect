// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  settingsDefaults,
  type AssetDto,
  type CanvasNodeDto,
} from "@opendirect/contract"
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

const { MediaNodeAssist, MediaNodeBody } = await import("./media-node")
const { CanvasSurfaceProvider, createNoteDrafts } =
  await import("../canvas-context")
type CanvasSurface = import("../canvas-context").CanvasSurface
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

describe("the full-size viewer", () => {
  it("opens on a double-click, and closes on Escape", async () => {
    const user = userEvent.setup()
    mount()
    expect(screen.queryByRole("dialog")).toBeNull()

    await user.dblClick(screen.getByRole("img", { name: /venkz-sheet-v3/ }))

    const viewer = await screen.findByRole("dialog", {
      name: "Full-size viewer",
    })
    expect(viewer).toHaveTextContent("venkz-sheet-v3.png")
    expect(viewer).toHaveTextContent("1024 × 1024")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // ⛔ Looking at a picture asks the main process for nothing.
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe("asking a local CLI about the selected image", () => {
  const surface: CanvasSurface = {
    containerId: null,
    noteDrafts: createNoteDrafts(),
    spawn: vi.fn(),
    pick: vi.fn(),
    branch: vi.fn(),
    selectGeneration: vi.fn(),
  }

  function mountAssist(installed: boolean) {
    invoke.mockImplementation(async (channel: string) => {
      switch (channel) {
        case "ai:tools":
          return {
            claude: {
              id: "claude",
              available: installed,
              path: installed ? "/bin/claude" : null,
              version: null,
            },
            codex: { id: "codex", available: false, path: null, version: null },
            preferred: installed ? "claude" : null,
            detectedAt: 1,
          }
        case "settings:get":
          return { ...settingsDefaults }
        case "ai:run":
          return {
            runId: "r",
            helper: "rethink-image",
            tool: "claude",
            text: "A lone figure at dusk, shot on a 35mm lens.",
            summary: null,
            shots: [],
            durationMs: 1,
          }
        default:
          throw new Error(`Unexpected channel ${channel}`)
      }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return render(
      <QueryClientProvider client={client}>
        <CanvasSurfaceProvider value={surface}>
          <MediaNodeAssist node={node} asset={asset} />
        </CanvasSurfaceProvider>
      </QueryClientProvider>
    )
  }

  it("rethinks the image by asset id and seeds a new node only on request", async () => {
    const user = userEvent.setup()
    mountAssist(true)

    await user.click(await screen.findByRole("button", { name: "AI helpers" }))
    await user.click(
      await screen.findByRole("button", { name: "Rethink image" })
    )

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai:run",
        expect.objectContaining({
          request: { helper: "rethink-image", assetId: "asset-1" },
        })
      )
    )
    expect(await screen.findByTestId("ai-result-text")).toHaveTextContent(
      "A lone figure at dusk"
    )
    // ⛔ Nothing is made until the user asks for it.
    expect(surface.spawn).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", { name: "New image node with this prompt" })
    )
    expect(surface.spawn).toHaveBeenCalledWith(node, "right", "image_gen", {
      prompt: "A lone figure at dusk, shot on a 35mm lens.",
    })
  })

  it("shows nothing without a local CLI", async () => {
    mountAssist(false)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai:tools"))
    expect(screen.queryByRole("button", { name: "AI helpers" })).toBeNull()
  })
})
