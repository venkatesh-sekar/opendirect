// @vitest-environment jsdom
import { DndContext, type DragEndEvent } from "@dnd-kit/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AssetDto,
  ContainerNodeDto,
  ImportResult,
  IpcChannel,
} from "@opendirect/contract"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ContainerTree } from "@/components/shell/container-tree"
import { useAssetDnd } from "@/hooks/use-asset-dnd"

import { Board } from "./board"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  // The AI helpers subscribe to `ai:progress`; nothing here ever pushes one.
  subscribe: () => () => {},
}))

function asset(id: string, overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id,
    projectId: "p1",
    kind: "image",
    relPath: `assets/${id}.png`,
    text: null,
    mimeType: "image/png",
    width: 800,
    height: 600,
    durationMs: null,
    bytes: 1024,
    sha256: id,
    thumbnailRelPath: null,
    label: id,
    originalName: `${id}.png`,
    pinned: false,
    generationId: null,
    createdAt: 1,
    url: `asset://p1/assets/${id}.png`,
    thumbnailUrl: null,
    ...overrides,
  }
}

function container(id: string): ContainerNodeDto {
  return {
    id,
    projectId: "p1",
    parentId: null,
    kind: "character",
    name: id,
    position: 0,
    createdAt: 0,
    children: [],
  }
}

/** Every channel the board and the tree reach for, answered from memory. */
function stubIpc(
  assets: AssetDto[],
  importResult?: Partial<ImportResult> & { paths?: string[] }
) {
  invoke.mockImplementation(async (channel: IpcChannel) => {
    switch (channel) {
      case "assets:list":
        return { items: assets, total: assets.length, nextOffset: null }
      case "generations:list":
        return { items: [], total: 0, nextOffset: null }
      case "assets:choose":
        return { paths: importResult?.paths ?? [] }
      case "assets:import":
        return {
          assets: [],
          imported: 0,
          deduped: 0,
          failures: [],
          ...importResult,
        }
      case "assets:addToContainer":
      case "assets:removeFromContainer":
        return { ok: true }
      default:
        throw new Error(`Unexpected channel ${channel}`)
    }
  })
}

/**
 * The board and the sidebar under one `DndContext`, exactly as the shell wires
 * them, with the drag-end event handed back so a test can deliver a drop
 * without asking jsdom to simulate a pointer across two panes.
 */
function Harness({
  containerId,
  onReady,
}: {
  containerId: string | null
  onReady?: (drop: (event: DragEndEvent) => void) => void
}) {
  const dnd = useAssetDnd()
  onReady?.(dnd.onDragEnd)

  return (
    <DndContext onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd}>
      <SidebarProvider>
        <ContainerTree
          nodes={[container("c2")]}
          selectedId={null}
          onSelect={() => {}}
        />
      </SidebarProvider>
      <Board containerId={containerId} title="Infinite Hotel" />
    </DndContext>
  )
}

function renderHarness(props: React.ComponentProps<typeof Harness>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  invoke.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("Board", () => {
  it("renders one card per asset in the container", async () => {
    stubIpc([asset("a1"), asset("a2"), asset("a3")])
    renderHarness({ containerId: "c1" })

    await waitFor(() =>
      expect(screen.getAllByTestId("asset-card")).toHaveLength(3)
    )
    expect(
      screen.getAllByTestId("asset-card").map((el) => el.dataset.assetId)
    ).toEqual(["a1", "a2", "a3"])
  })

  it("invites the first file when the container is empty", async () => {
    stubIpc([])
    renderHarness({ containerId: "c1" })

    expect(
      await screen.findByText("Drop files or generate something.")
    ).toBeDefined()
    expect(screen.queryAllByTestId("asset-card")).toHaveLength(0)
  })

  it("plays video with a poster fallback rather than a generated thumbnail", async () => {
    stubIpc([asset("v1", { kind: "video", url: "asset://p1/v1.mp4" })])
    const { container: root } = renderHarness({ containerId: "c1" })

    await waitFor(() => expect(root.querySelector("video")).not.toBeNull())
    const video = root.querySelector("video")!
    expect(video.getAttribute("src")).toBe("asset://p1/v1.mp4")
    expect(video.hasAttribute("poster")).toBe(false)
  })
})

describe("importing", () => {
  it("reports what the import did, failures included", async () => {
    stubIpc([], {
      paths: ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"],
      imported: 2,
      deduped: 1,
      failures: [{ path: "/tmp/c.png", message: "Unreadable" }],
    })
    renderHarness({ containerId: "c1" })

    fireEvent.click(await screen.findByRole("button", { name: /import/i }))

    expect(
      await screen.findByText("2 imported · 1 already here · 1 failed")
    ).toBeDefined()
    expect(screen.getByText(/\/tmp\/c\.png — Unreadable/)).toBeDefined()
  })

  it("explains itself when a drop carries no file paths", async () => {
    stubIpc([])
    renderHarness({ containerId: "c1" })
    const scroll = await screen.findByTestId("board-scroll")

    fireEvent.drop(scroll, { dataTransfer: { files: [], types: ["Files"] } })

    expect(await screen.findByText("Nothing to import")).toBeDefined()
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "assets:import")
    ).toHaveLength(0)
  })
})

describe("dragging a card onto a sidebar container", () => {
  it("adds the asset to that container exactly once", async () => {
    stubIpc([asset("a1")])
    let drop: ((event: DragEndEvent) => void) | undefined
    renderHarness({
      containerId: "c1",
      onReady: (handler) => {
        drop = handler
      },
    })

    const card = await screen.findByTestId("asset-card")
    const row = screen.getByTestId("container-row")

    drop!({
      active: {
        id: `asset:${card.dataset.assetId}`,
        data: {
          current: {
            type: "asset",
            assetId: card.dataset.assetId,
            containerId: "c1",
          },
        },
      },
      over: {
        id: `container:${row.dataset.containerId}`,
        data: {
          current: { type: "container", containerId: row.dataset.containerId },
        },
      },
    } as unknown as DragEndEvent)

    await waitFor(() => {
      const calls = invoke.mock.calls.filter(
        ([channel]) => channel === "assets:addToContainer"
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]![1]).toEqual({ containerId: "c2", assetId: "a1" })
    })

    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === "assets:removeFromContainer"
      )
    ).toHaveLength(0)
  })

  it("does nothing when the card lands back on its own board", async () => {
    stubIpc([asset("a1")])
    let drop: ((event: DragEndEvent) => void) | undefined
    renderHarness({
      containerId: "c1",
      onReady: (handler) => {
        drop = handler
      },
    })
    await screen.findByTestId("asset-card")

    drop!({
      active: {
        id: "asset:a1",
        data: { current: { type: "asset", assetId: "a1", containerId: "c1" } },
      },
      over: {
        id: "container:c1",
        data: { current: { type: "container", containerId: "c1" } },
      },
    } as unknown as DragEndEvent)

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === "assets:addToContainer"
        )
      ).toHaveLength(0)
    )
  })
})
