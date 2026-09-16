// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { DndContext } from "@dnd-kit/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { CanvasNodeDto } from "@opendirect/contract"

import { Canvas, modelKeyOfNode, toFlowNodes } from "./canvas"

/**
 * No bridge, and therefore no project and nothing to draw.
 *
 * The canvas gives the same answer the shell does, for the same reason: the
 * renderer is one static export opened both by the Electron window and by a
 * plain browser tab, and only one of them has a preload.
 */
const bridge = vi.hoisted(() => ({
  present: false,
  responses: {} as Record<string, unknown>,
}))

vi.mock("@/lib/ipc", () => ({
  invoke: (channel: string) =>
    channel in bridge.responses
      ? Promise.resolve(bridge.responses[channel])
      : new Promise(() => {}),
  isBridgeAvailable: () => bridge.present,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

afterEach(() => {
  cleanup()
  bridge.present = false
  bridge.responses = {}
})

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DndContext>
        <Canvas containerId="shelf" />
      </DndContext>
    </QueryClientProvider>
  )
}

function node(over: Partial<CanvasNodeDto> & { id: string }): CanvasNodeDto {
  return {
    projectId: "p1",
    type: "image_gen",
    x: 0,
    y: 0,
    width: 320,
    height: 320,
    assetId: null,
    generationId: null,
    batchId: null,
    pickAssetId: null,
    modelKey: null,
    text: null,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    asset: null,
    generation: null,
    ...over,
  } as CanvasNodeDto
}

/**
 * The one function both the auto-assignment of a new edge's slot and the edge
 * label's slot menu ask. A node that has never run has no generation, so
 * before the row carried a model both of them came up empty.
 */
describe("modelKeyOfNode", () => {
  it("reads the model chosen on a node that has never run", () => {
    expect(
      modelKeyOfNode(
        node({ id: "g1", modelKey: "replicate:google/nano-banana-2" })
      )
    ).toBe("replicate:google/nano-banana-2")
  })

  it("falls back to the run behind the node, and to nothing at all", () => {
    const ran = node({
      id: "g1",
      generation: { provider: "replicate", modelSlug: "a/b" },
    } as unknown as Partial<CanvasNodeDto> & { id: string })
    expect(modelKeyOfNode(ran)).toBe("replicate:a/b")
    expect(modelKeyOfNode(node({ id: "g2" }))).toBeNull()
    expect(modelKeyOfNode(undefined)).toBeNull()
  })
})

/**
 * Selecting a node used to rebuild every node React Flow draws, so every
 * generate node on the surface re-rendered — and each of those redoes its own
 * batch join. Only the nodes whose selection actually changed may be rebuilt.
 */
describe("toFlowNodes", () => {
  it("reuses the object for every node the change did not touch", () => {
    const rows = [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })]
    const cache = new Map<string, ReturnType<typeof toFlowNodes>[number]>()

    const first = toFlowNodes(rows, new Set(), cache)
    const second = toFlowNodes(rows, new Set(["b"]), cache)

    expect(second[0]).toBe(first[0])
    expect(second[2]).toBe(first[2])
    expect(second[1]).not.toBe(first[1])
    expect(second[1]!.selected).toBe(true)
  })

  it("rebuilds a node whose row changed, and forgets deleted ones", () => {
    const a = node({ id: "a" })
    const cache = new Map<string, ReturnType<typeof toFlowNodes>[number]>()

    const first = toFlowNodes([a, node({ id: "b" })], new Set(), cache)
    const moved = { ...a, x: 40 }
    const second = toFlowNodes([moved], new Set(), cache)

    expect(second[0]).not.toBe(first[0])
    expect(second[0]!.position).toEqual({ x: 40, y: 0 })
    expect(cache.has("b")).toBe(false)
  })
})

describe("Canvas", () => {
  it("renders the placeholder outside Electron", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Canvas containerId={null} />
      </QueryClientProvider>
    )

    expect(screen.getByText(/runs in its desktop window/i)).toBeVisible()
    // Nothing of React Flow is mounted, so nothing asked for a viewport.
    expect(screen.queryByTestId("canvas-surface")).toBeNull()
    expect(screen.queryByTestId("canvas-rail")).toBeNull()
  })

  /**
   * A new project used to open on a dot grid and nothing else — no onboarding,
   * and no sign that the rail's "+" is where a canvas starts.
   */
  it("says what to do when there is nothing on it", async () => {
    bridge.present = true
    bridge.responses = {
      "canvas:get": { nodes: [], edges: [] },
      "generations:list": { items: [], total: 0 },
      "settings:get": {
        projectRoot: null,
        maxConcurrentJobs: 2,
        pollIntervalMs: 3000,
      },
    }
    mount()

    const empty = await screen.findByTestId("canvas-empty-state")
    expect(empty).toHaveTextContent(/Nothing on the canvas yet/i)
    // The rail's "+" carries the same label, so the assertion is scoped: the
    // point is that the empty state offers the first move itself.
    expect(
      within(empty).getByRole("button", { name: /add a node/i })
    ).toBeInTheDocument()
  })

  it("keeps the empty state out of the way once a node exists", async () => {
    bridge.present = true
    bridge.responses = {
      "canvas:get": {
        nodes: [
          {
            id: "n1",
            type: "text",
            x: 0,
            y: 0,
            width: 240,
            height: 120,
            text: "hello",
            children: [],
          },
        ],
        edges: [],
      },
      "generations:list": { items: [], total: 0 },
      "settings:get": {
        projectRoot: null,
        maxConcurrentJobs: 2,
        pollIntervalMs: 3000,
      },
    }
    mount()

    await screen.findByTestId("canvas-surface")
    expect(screen.queryByTestId("canvas-empty-state")).toBeNull()
  })
})
