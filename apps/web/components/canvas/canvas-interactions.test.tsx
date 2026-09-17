// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { createElement } from "react"
import { DndContext } from "@dnd-kit/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactFlowProps, ReactFlowState } from "@xyflow/react"
import type { CanvasDto, CanvasNodeDto } from "@opendirect/contract"
import { afterEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/hooks/query-keys"
import type { CanvasFlowEdge, CanvasFlowNode } from "./nodes/types"
import { Canvas } from "./canvas"
import { useCanvasSurface, type CanvasSurface } from "./canvas-context"

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  props: null as ReactFlowProps<CanvasFlowNode, CanvasFlowEdge> | null,
  state: null as (() => ReactFlowState<CanvasFlowNode, CanvasFlowEdge>) | null,
  surface: null as CanvasSurface | null,
}))
vi.mock("@/lib/ipc", () => ({
  invoke: fixture.invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps<CanvasFlowNode, CanvasFlowEdge>) => {
      fixture.props = props
      fixture.surface = useCanvasSurface()
      fixture.state = actual.useStoreApi<
        CanvasFlowNode,
        CanvasFlowEdge
      >().getState
      return createElement(
        actual.ReactFlow<CanvasFlowNode, CanvasFlowEdge>,
        props
      )
    },
  }
})

function row(id: string, x: number): CanvasNodeDto {
  return {
    id,
    projectId: "p",
    type: "text",
    x,
    y: 0,
    width: 240,
    height: 120,
    text: id,
    color: null,
    assetId: null,
    generationId: null,
    batchId: null,
    pickAssetId: null,
    modelKey: null,
    asset: null,
    generation: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function mount() {
  const canvas: CanvasDto = { nodes: [row("a", 0), row("b", 300)], edges: [] }
  fixture.invoke.mockImplementation((channel: string) => {
    if (channel === "canvas:get") return Promise.resolve(canvas)
    if (channel === "canvas:node:move") return Promise.resolve({ ok: true })
    if (channel === "generations:list")
      return Promise.resolve({ items: [], total: 0 })
    if (channel === "settings:get") return Promise.resolve({})
    return new Promise(() => {})
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(queryKeys.canvas.graph, canvas)
  const view = render(
    <QueryClientProvider client={client}>
      <DndContext>
        <Canvas containerId="shelf" />
      </DndContext>
    </QueryClientProvider>
  )
  await waitFor(() => expect(fixture.state?.().nodes).toHaveLength(2))
  return { client, ...view }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("canvas interaction persistence", () => {
  it("shows and connects a newly created node before a background refetch completes", async () => {
    const { client } = await mount()
    fixture.invoke.mockImplementation((channel: string, input: unknown) => {
      if (channel === "canvas:node:create")
        return Promise.resolve({ ...row("c", 600), type: "image_gen" })
      if (channel === "canvas:edge:create")
        return Promise.resolve({
          id: "ac",
          projectId: "p",
          createdAt: 1,
          ...(input as object),
        })
      return new Promise(() => {})
    })
    act(() => fixture.surface!.spawn(row("a", 0), "right", "image_gen"))
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith("canvas:edge:create", {
        sourceNodeId: "a",
        targetNodeId: "c",
        slotField: null,
      })
    )
    await waitFor(() =>
      expect(
        client.getQueryData<CanvasDto>(queryKeys.canvas.graph)?.edges
      ).toHaveLength(1)
    )
    expect(
      client
        .getQueryData<CanvasDto>(queryKeys.canvas.graph)
        ?.nodes.map((node) => node.id)
    ).toEqual(["a", "b", "c"])
  })

  it("keeps all drag frames in React Flow, then saves the exact final group position with undo/redo", async () => {
    const { client } = await mount()
    const before = client.getQueryData<CanvasDto>(queryKeys.canvas.graph)
    const initial = fixture.state!().nodes
    const event = new MouseEvent("mousemove")
    act(() => fixture.props!.onNodeDragStart!(event, initial[0]!, initial))
    for (let frame = 1; frame <= 60; frame++) {
      act(() =>
        fixture.state!().triggerNodeChanges(
          initial.map((node) => ({
            type: "position" as const,
            id: node.id,
            position: { x: node.position.x + frame, y: frame },
            dragging: true,
          }))
        )
      )
    }
    expect(client.getQueryData(queryKeys.canvas.graph)).toBe(before)
    expect(
      fixture.invoke.mock.calls.filter(
        ([channel]) => channel === "canvas:node:move"
      )
    ).toHaveLength(0)
    const final = fixture.state!().nodes
    expect(final[0]!.position).toEqual({ x: 60, y: 60 })
    act(() => {
      fixture.state!().triggerNodeChanges(
        final.map((node) => ({
          type: "position" as const,
          id: node.id,
          position: node.position,
          dragging: false,
        }))
      )
      fixture.props!.onNodeDragStop!(event, final[0]!, final)
    })
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith("canvas:node:move", {
        moves: [
          { id: "a", x: 60, y: 60 },
          { id: "b", x: 360, y: 60 },
        ],
      })
    )
    expect(
      fixture.invoke.mock.calls.filter(
        ([channel]) => channel === "canvas:node:move"
      )
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Undo Move 2 nodes" }))
    await waitFor(() =>
      expect(
        client.getQueryData<CanvasDto>(queryKeys.canvas.graph)?.nodes[0]?.x
      ).toBe(0)
    )
    fireEvent.click(screen.getByRole("button", { name: "Redo Move 2 nodes" }))
    await waitFor(() =>
      expect(
        client.getQueryData<CanvasDto>(queryKeys.canvas.graph)?.nodes[1]?.x
      ).toBe(360)
    )
  })

  it("preserves a live position across background updates and saves it on unmount", async () => {
    const { client, unmount } = await mount()
    act(() =>
      fixture.state!().triggerNodeChanges([
        {
          type: "position",
          id: "a",
          position: { x: 88, y: 99 },
          dragging: true,
        },
      ])
    )
    act(() =>
      client.setQueryData<CanvasDto>(queryKeys.canvas.graph, (canvas) => ({
        ...canvas!,
        nodes: canvas!.nodes.map((node) =>
          node.id === "a" ? { ...node, text: "Updated" } : node
        ),
      }))
    )
    await waitFor(() =>
      expect(fixture.state!().nodes[0]!.data.node.text).toBe("Updated")
    )
    expect(fixture.state!().nodes[0]!.position).toEqual({ x: 88, y: 99 })
    unmount()
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith("canvas:node:move", {
        moves: [{ id: "a", x: 88, y: 99 }],
      })
    )
  })

  it("persists keyboard nudges and handles consecutive selection events without stale selections", async () => {
    const { client } = await mount()
    act(() => {
      fixture.state!().triggerNodeChanges([
        { type: "select", id: "a", selected: true },
      ])
      fixture.state!().triggerNodeChanges([
        { type: "select", id: "a", selected: false },
      ])
      fixture.state!().triggerNodeChanges([
        { type: "select", id: "b", selected: true },
      ])
    })
    await waitFor(() =>
      expect(
        fixture.state!()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id)
      ).toEqual(["b"])
    )
    act(() =>
      fixture.state!().triggerNodeChanges([
        {
          type: "position",
          id: "b",
          position: { x: 305, y: 0 },
          dragging: false,
        },
      ])
    )
    expect(
      client.getQueryData<CanvasDto>(queryKeys.canvas.graph)?.nodes[1]?.x
    ).toBe(305)
    await waitFor(() =>
      expect(fixture.invoke).toHaveBeenCalledWith("canvas:node:move", {
        moves: [{ id: "b", x: 305, y: 0 }],
      })
    )
  })
})
