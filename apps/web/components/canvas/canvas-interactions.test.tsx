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
import userEvent from "@testing-library/user-event"
import {
  Position,
  type ReactFlowProps,
  type ReactFlowState,
} from "@xyflow/react"
import type { CanvasDto, CanvasNodeDto } from "@opendirect/contract"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { queryKeys } from "@/hooks/query-keys"
import type { CanvasFlowEdge, CanvasFlowNode } from "./nodes/types"
import { Canvas } from "./canvas"
import { useCanvasSurface, type CanvasSurface } from "./canvas-context"

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  props: null as ReactFlowProps<CanvasFlowNode, CanvasFlowEdge> | null,
  state: null as (() => ReactFlowState<CanvasFlowNode, CanvasFlowEdge>) | null,
  setState: null as
    | ((patch: Partial<ReactFlowState<CanvasFlowNode, CanvasFlowEdge>>) => void)
    | null,
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
      const store = actual.useStoreApi<CanvasFlowNode, CanvasFlowEdge>()
      fixture.state = store.getState
      fixture.setState = store.setState
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
    providerOverride: null,
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

describe("the composer on a real canvas", () => {
  /** A note wired into a generate node — the pair the composer shows. */
  async function mountComposer({ picture = false } = {}) {
    const canvas: CanvasDto = {
      nodes: [
        { ...row("note", 0), text: "a bellhop opens the lift" },
        { ...row("gen", 400), type: "video_gen", text: null },
        ...(picture
          ? [
              {
                ...row("pic", 0),
                type: "media" as const,
                text: null,
                assetId: "a-lobby",
                asset: {
                  id: "a-lobby",
                  kind: "image",
                  label: "lobby",
                  url: "asset://media/a-lobby.png",
                  thumbnailUrl: null,
                } as unknown as CanvasNodeDto["asset"],
              },
            ]
          : []),
      ],
      edges: [
        {
          id: "e-note",
          projectId: "p",
          sourceNodeId: "note",
          targetNodeId: "gen",
          slotField: null,
          createdAt: 1,
        },
        ...(picture
          ? [
              {
                id: "e-pic",
                projectId: "p",
                sourceNodeId: "pic",
                targetNodeId: "gen",
                slotField: "reference_images",
                createdAt: 2,
              },
            ]
          : []),
      ],
    }
    fixture.invoke.mockImplementation((channel: string) => {
      if (channel === "canvas:get") return Promise.resolve(canvas)
      if (channel === "canvas:edge:delete") return Promise.resolve({ ok: true })
      if (channel === "canvas:edge:create")
        return Promise.resolve({ ...canvas.edges[0], id: "e-again" })
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
        <TooltipProvider>
          <DndContext>
            <Canvas containerId="shelf" />
          </DndContext>
        </TooltipProvider>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(fixture.state?.().nodes).toHaveLength(canvas.nodes.length)
    )
    act(() => fixture.surface!.selectNode!("gen"))
    await waitFor(() =>
      expect(
        fixture.state!()
          .nodes.filter((node) => node.selected)
          .map((node) => node.id)
      ).toEqual(["gen"])
    )
    const note = await screen.findByRole("button", {
      name: /note 1, a bellhop opens the lift/i,
    })
    return { client, note, ...view }
  }

  function channelCalls(channel: string) {
    return fixture.invoke.mock.calls.filter(([one]) => one === channel)
  }

  it("⛔ Delete on a focused note disconnects it and never deletes the selected node", async () => {
    const user = userEvent.setup()
    const { note } = await mountComposer()

    note.focus()
    await user.keyboard("{Delete}")

    await waitFor(() =>
      expect(channelCalls("canvas:edge:delete")).toHaveLength(1)
    )
    expect(channelCalls("canvas:edge:delete")[0]![1]).toEqual({
      ids: ["e-note"],
    })
    expect(channelCalls("canvas:node:delete")).toHaveLength(0)
    expect(fixture.state!().nodes.map((node) => node.id)).toContain("gen")
  })

  it("keeps the prompt bar out of the canvas's pan and drag", async () => {
    await mountComposer()
    // React Flow's d3-zoom swallows a mousedown outside `.nopan`, so a
    // control that opens on mousedown (the provider Select) never opened.
    const controls = screen.getByTestId("prompt-bar-controls")
    expect(controls.closest(".nopan")).not.toBeNull()
    expect(controls.closest(".nodrag")).not.toBeNull()
  })

  it("puts the composer's ✕ on the undo stack", async () => {
    const user = userEvent.setup()
    await mountComposer()

    // A bare click: user-event's mousedown reaches d3-zoom, which cannot
    // find a window in jsdom.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Disconnect a bellhop opens the lift",
      })
    )
    await waitFor(() =>
      expect(channelCalls("canvas:edge:delete")).toHaveLength(1)
    )

    // jsdom reports no platform, so `mod` is Control.
    await user.keyboard("{Control>}z{/Control}")
    await waitFor(() =>
      expect(channelCalls("canvas:edge:create")).toHaveLength(1)
    )
    expect(channelCalls("canvas:edge:create")[0]![1]).toMatchObject({
      sourceNodeId: "note",
      targetNodeId: "gen",
    })
  })

  it("puts a thumbnail's ✕ on the undo stack", async () => {
    const user = userEvent.setup()
    await mountComposer({ picture: true })

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect lobby" })
    )
    await waitFor(() =>
      expect(channelCalls("canvas:edge:delete")).toHaveLength(1)
    )
    expect(channelCalls("canvas:edge:delete")[0]![1]).toEqual({
      ids: ["e-pic"],
    })

    await user.keyboard("{Control>}z{/Control}")
    await waitFor(() =>
      expect(channelCalls("canvas:edge:create")).toHaveLength(1)
    )
    expect(channelCalls("canvas:edge:create")[0]![1]).toMatchObject({
      sourceNodeId: "pic",
      targetNodeId: "gen",
      slotField: "reference_images",
    })
  })

  /**
   * jsdom lays nothing out, so React Flow never measures a node or its
   * handles and draws no edge. Hand it the measurements a browser would: a
   * viewport, each node's size, and a handle on either side.
   */
  function layOut() {
    act(() => {
      const state = fixture.state!()
      for (const node of state.nodeLookup.values()) {
        const width = node.width ?? 240
        const height = node.height ?? 120
        node.measured = { width, height }
        node.internals.handleBounds = {
          source: [
            {
              id: null,
              type: "source",
              nodeId: node.id,
              position: Position.Right,
              x: width,
              y: height / 2,
              width: 1,
              height: 1,
            },
          ],
          target: [
            {
              id: null,
              type: "target",
              nodeId: node.id,
              position: Position.Left,
              x: 0,
              y: height / 2,
              width: 1,
              height: 1,
            },
          ],
        }
      }
      fixture.setState!({
        width: 2000,
        height: 1000,
        transform: [0, 0, 1],
        edges: [...state.edges],
      })
    })
  }

  it("lights the hovered note and its wire, and clears them after", async () => {
    const { container } = await mountComposer()
    const noteNode = () =>
      container.querySelector('.react-flow__node[data-id="note"]')
    const wire = () =>
      container.querySelector('.react-flow__edge[data-id="e-note"]')
    await waitFor(() => expect(noteNode()).not.toBeNull())
    layOut()
    await waitFor(() => expect(wire()).not.toBeNull())

    act(() => fixture.surface!.highlightNote!("note"))
    expect(noteNode()).toHaveAttribute("data-prompt-highlight")
    expect(wire()).toHaveAttribute("data-prompt-highlight")

    act(() => fixture.surface!.highlightNote!(null))
    expect(noteNode()).not.toHaveAttribute("data-prompt-highlight")
    expect(container.querySelector("[data-prompt-highlight]")).toBeNull()
  })
})
