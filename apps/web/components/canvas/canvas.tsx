"use client"

/**
 * The canvas.
 *
 * React Flow owns pan, zoom, edges, handles, selection and the minimap. None
 * of it is re-implemented here; what this file does is hold the line between
 * the two stores the design draws:
 *
 * - **React Flow's store holds the transient state** — the viewport, the drag
 *   in flight, the connection line being drawn. It is never persisted and
 *   never goes through IPC.
 * - **The query cache holds the rows.** Nodes and edges handed to React Flow
 *   are synchronized from `useCanvas()` when persisted rows change.
 *
 * The two meet in exactly two places. Positions are written through
 * `useCanvasNodeMover` at gesture end, with one `canvas:node:move`.
 * Everything else — adds, deletes, edge
 * changes, picks — is written the moment it happens.
 *
 * ⛔ Nothing on this surface spends money. Drawing an edge states what the
 * *next* run should be given; it never starts one. Submitting is the prompt
 * bar's Generate button and nothing else.
 */
import {
  pendingCanvasFocus,
  resolveCanvasFocus,
  subscribeCanvasFocus,
  clearCanvasFocus,
} from "@/lib/canvas/focus-request"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DragEvent } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { useDndMonitor, useDroppable } from "@dnd-kit/core"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Background,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
} from "@xyflow/react"
import type {
  CanvasDto,
  CanvasEdgeDto,
  CanvasNodeDto,
  CanvasNodeMove,
  CanvasNodeType,
  GenerationDto,
  ModelDescriptor,
} from "@opendirect/contract"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useChooseFiles, useImportAssets } from "@/hooks/use-assets"
import { useBridge } from "@/hooks/use-bridge"
import {
  useCanvas,
  useCanvasMigrate,
  useCanvasNodeMover,
  useCreateCanvasEdge,
  useCreateCanvasNode,
  useDeleteCanvasEdges,
  useDeleteCanvasNodes,
  usePickCanvasNode,
  useUpdateCanvasNode,
} from "@/hooks/use-canvas"
import { useCanvasHistory } from "@/hooks/use-canvas-history"
import { queryKeys } from "@/hooks/query-keys"
import { useGenerations } from "@/hooks/use-generations"
import { modelDescriptorQuery } from "@/hooks/use-models"
import { isAssetDragData } from "@/lib/board/drop-target"
import {
  aspectRatioOf,
  defaultNodeSize,
  dropPosition,
  dropPositions,
  spawnPosition,
  type AspectRatio,
  type Box,
} from "@/lib/canvas/layout"
import {
  availableSlots,
  contributedKind,
  firstFreeSlot,
  modelOptionsForNode,
} from "@/lib/canvas/slots"
import { pathsForFiles } from "@/lib/ipc"
import { modelKeyOf } from "@/lib/model-key"
import { useSettings } from "@/lib/settings"

import {
  CanvasSurfaceProvider,
  createNoteDrafts,
  type CanvasSurface,
} from "./canvas-context"
import { CanvasRail, type CanvasMode } from "./canvas-rail"
import { ReferenceEdge } from "./edges/reference-edge"
import { DefaultCanvasPick, GenerateNode } from "./nodes/generate-node"
import { MediaNode } from "./nodes/media-node"
import { isGenerateNode } from "./nodes/node-frame"
import { TextNode } from "./nodes/text-node"
import type {
  CanvasFlowEdge,
  CanvasFlowNode,
  TargetModelOptions,
} from "./nodes/types"
import { WorkflowLibrary } from "./workflow-library"
import { PromptBar, seedPromptDraft } from "./prompt-bar"

/**
 * Registered once, at module scope. React Flow re-creates every node in the
 * graph when this object's identity changes, so it must never be rebuilt on a
 * render.
 */
// The wrapper moves; these bodies only read data and selection. In particular,
// x/y and dragging props must not rerender media, menus and batch joins.
function sameNodeContent(
  a: NodeProps<CanvasFlowNode>,
  b: NodeProps<CanvasFlowNode>
) {
  return a.data === b.data && a.selected === b.selected
}
const MemoGenerateNode = memo(GenerateNode, sameNodeContent)
const nodeTypes = {
  text: memo(TextNode, sameNodeContent),
  media: memo(MediaNode, sameNodeContent),
  image_gen: MemoGenerateNode,
  video_gen: MemoGenerateNode,
}

const edgeTypes = { reference: memo(ReferenceEdge) }
const INITIAL_NODES: CanvasFlowNode[] = []

/** The droppable id the sidebar's asset drag lands on. */
export const CANVAS_DROPPABLE_ID = "canvas"

function boxOf(node: CanvasNodeDto): Box {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

/**
 * The nodes React Flow draws, reusing the object for every node a change did
 * not touch.
 *
 * Selection used to rebuild all of them — the memo depended on the selected
 * set, so clicking one node handed React Flow a fresh object for every other
 * one and the whole graph re-rendered, each generate node redoing its own
 * batch join. The cache makes the rebuild proportional to what actually
 * changed: the node that was selected, the node that was deselected, and
 * whatever row the server sent back.
 *
 * It is a pure function over a caller-owned cache so it can be tested without
 * a canvas; the cache is a ref in the component.
 */
export function toFlowNodes(
  rows: readonly CanvasNodeDto[],
  selected: ReadonlySet<string>,
  cache: Map<string, CanvasFlowNode>
): CanvasFlowNode[] {
  const next: CanvasFlowNode[] = []
  const live = new Set<string>()

  for (const node of rows) {
    live.add(node.id)
    const chosen = selected.has(node.id)
    const previous = cache.get(node.id)
    if (
      previous &&
      previous.data.node === node &&
      previous.selected === chosen
    ) {
      next.push(previous)
      continue
    }
    const flow: CanvasFlowNode = {
      id: node.id,
      type: node.type,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      selected: chosen,
      data: { node },
    }
    cache.set(node.id, flow)
    next.push(flow)
  }

  // A deleted node must not keep its object alive in here.
  if (cache.size !== live.size) {
    for (const id of cache.keys()) if (!live.has(id)) cache.delete(id)
  }

  return next
}

/** Preserve measurements and unchanged live objects when persisted rows arrive. */
export function reconcileFlowNodes(
  rows: CanvasFlowNode[],
  current: CanvasFlowNode[]
): CanvasFlowNode[] {
  const byId = new Map(current.map((node) => [node.id, node]))
  const next = rows.map((node) => {
    const live = byId.get(node.id)
    if (!live) return node
    const position = live.dragging ? live.position : node.position
    const data = live.data.node === node.data.node ? live.data : node.data
    if (
      live.position.x === position.x &&
      live.position.y === position.y &&
      live.data === data &&
      live.selected === node.selected &&
      live.type === node.type &&
      live.width === node.width &&
      live.height === node.height
    )
      return live
    return { ...live, ...node, position, data, dragging: live.dragging }
  })
  return current.length === next.length &&
    next.every((node, index) => node === current[index])
    ? current
    : next
}

/**
 * The model a node's slots come from.
 *
 * The node's own `modelKey` first — what the prompt bar wrote when the user
 * chose a model — so a node that has never run still declares slots and a
 * fresh edge into it can be resolved. The run behind it is the fallback, for
 * rows that predate the column.
 */
export function modelKeyOfNode(node: CanvasNodeDto | undefined): string | null {
  if (!node) return null
  return node.modelKey ?? (node.generation ? modelKeyOf(node.generation) : null)
}

function sameOptions(a: TargetModelOptions, b: TargetModelOptions): boolean {
  return (
    a.provider === b.provider && a.filled.join("\n") === b.filled.join("\n")
  )
}

export function toFlowEdges(
  rows: readonly CanvasEdgeDto[],
  nodes: readonly CanvasNodeDto[],
  selected: ReadonlySet<string>,
  cache: Map<string, CanvasFlowEdge>
): CanvasFlowEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const live = new Set<string>()
  /** One per target: every edge into a node shares its options. */
  const optionsOf = new Map<string, TargetModelOptions>()
  const targetOptions = (targetNodeId: string): TargetModelOptions => {
    let options = optionsOf.get(targetNodeId)
    if (!options) {
      options = modelOptionsForNode(
        {
          id: targetNodeId,
          providerOverride: byId.get(targetNodeId)?.providerOverride ?? null,
        },
        rows
      )
      optionsOf.set(targetNodeId, options)
    }
    return options
  }
  /** Wires per target and slot, keyed `target\nslot`. */
  const wires = new Map<string, number>()
  const wireKey = (edge: CanvasEdgeDto) =>
    `${edge.targetNodeId}\n${edge.slotField}`
  for (const edge of rows) {
    if (edge.slotField === null) continue
    wires.set(wireKey(edge), (wires.get(wireKey(edge)) ?? 0) + 1)
  }
  const result = rows.map((edge) => {
    live.add(edge.id)
    const chosen = selected.has(edge.id)
    const targetModelKey = modelKeyOfNode(byId.get(edge.targetNodeId))
    const targetModelOptions = targetOptions(edge.targetNodeId)
    const slotWires =
      edge.slotField === null ? 0 : (wires.get(wireKey(edge)) ?? 0)
    const previous = cache.get(edge.id)
    if (
      previous?.data?.edge === edge &&
      previous.selected === chosen &&
      previous.data.targetModelKey === targetModelKey &&
      previous.data.slotWires === slotWires &&
      sameOptions(previous.data.targetModelOptions, targetModelOptions)
    )
      return previous
    const next: CanvasFlowEdge = {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      type: "reference",
      selected: chosen,
      data: { edge, targetModelKey, targetModelOptions, slotWires },
    }
    cache.set(edge.id, next)
    return next
  })
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id)
  return result
}

function CanvasSurfaceInner({ containerId }: CanvasProps) {
  const canvasQuery = useCanvas()
  const canvas: CanvasDto = useMemo(
    () => canvasQuery.data ?? { nodes: [], edges: [] },
    [canvasQuery.data]
  )
  // Read inside callbacks, where a closure over `canvas` would be one render
  // behind whatever the last mutation wrote. Written in an effect rather than
  // during render: an effect has run by the time any event handler can fire.
  const latest = useRef(canvas)
  useEffect(() => {
    latest.current = canvas
  }, [canvas])

  const client = useQueryClient()
  const settings = useSettings()
  const { screenToFlowPosition, setCenter, fitView } = useReactFlow()
  const flowStore = useStoreApi<CanvasFlowNode, CanvasFlowEdge>()

  const mover = useCanvasNodeMover()
  const createNode = useCreateCanvasNode()
  const updateNode = useUpdateCanvasNode()
  const deleteNodes = useDeleteCanvasNodes()
  const createEdge = useCreateCanvasEdge()
  const deleteEdges = useDeleteCanvasEdges()
  const pickNode = usePickCanvasNode()
  const history = useCanvasHistory()

  const importAssets = useImportAssets()
  const chooseFiles = useChooseFiles()
  const generations = useGenerations(containerId, { limit: 1 })

  const [mode, setMode] = useState<CanvasMode>("pan")
  const [selectedNodes, setSelectedNodes] = useState<readonly string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<readonly string[]>([])
  const [fileDropActive, setFileDropActive] = useState(false)
  const [migrationDismissed, setMigrationDismissed] = useState(false)
  const canvasLoaded = canvasQuery.data !== undefined
  useEffect(() => {
    const focus = () => {
      const id = pendingCanvasFocus()
      if (!id) return
      const target = resolveCanvasFocus(canvas.nodes, id)
      if (!target) {
        // A container with nothing on the canvas yet: once the surface has
        // loaded, there is nothing to wait for, and a request left pending
        // would frame the first node filed there much later, out of nowhere.
        if (canvasLoaded && !canvas.nodes.some((node) => node.id === id))
          clearCanvasFocus(id)
        return
      }
      if (target.kind === "node") {
        setSelectedNodes([id])
        setSelectedEdges([])
        const node = canvas.nodes.find((node) => node.id === id)!
        void setCenter?.(node.x + node.width / 2, node.y + node.height / 2, {
          zoom: 0.85,
          duration: 300,
        })
      } else {
        void fitView?.({
          nodes: target.ids.map((nodeId) => ({ id: nodeId })),
          padding: 0.2,
          maxZoom: 1,
          duration: 300,
        })
      }
      clearCanvasFocus(id)
    }
    focus()
    return subscribeCanvasFocus(focus)
  }, [canvas.nodes, canvasLoaded, setCenter, fitView])

  /* ------------------------------------------------------------------ */
  /* Rows → what React Flow draws                                        */
  /* ------------------------------------------------------------------ */

  // One cache for the life of the surface. `toFlowNodes` only ever reuses or
  // replaces entries by identity, so a double render produces the same array.
  const flowNodeCache = useMemo(() => new Map<string, CanvasFlowNode>(), [])
  const flowNodes: CanvasFlowNode[] = useMemo(
    () => toFlowNodes(canvas.nodes, new Set(selectedNodes), flowNodeCache),
    [canvas.nodes, selectedNodes, flowNodeCache]
  )

  // React Flow applies pointer movement locally. Only persisted changes and
  // explicit selection changes cross back into its store. A background query
  // refresh must not reset a node currently under the pointer.
  useEffect(() => {
    const { nodes, setNodes } = flowStore.getState()
    const next = reconcileFlowNodes(flowNodes, nodes)
    if (next !== nodes) setNodes(next)
  }, [flowNodes, flowStore])

  const flowEdgeCache = useMemo(() => new Map<string, CanvasFlowEdge>(), [])
  const flowEdges = useMemo(
    () =>
      toFlowEdges(
        canvas.edges,
        canvas.nodes,
        new Set(selectedEdges),
        flowEdgeCache
      ),
    [canvas.nodes, canvas.edges, selectedEdges, flowEdgeCache]
  )

  /* ------------------------------------------------------------------ */
  /* Moving                                                              */
  /* ------------------------------------------------------------------ */

  const dragStart = useRef<CanvasNodeMove[]>([])
  const liveMoves = useRef(new Map<string, CanvasNodeMove>())

  useEffect(() => {
    const save = () => {
      mover.move([...liveMoves.current.values()])
      liveMoves.current.clear()
      mover.flush()
    }
    window.addEventListener("blur", save)
    window.addEventListener("pagehide", save)
    return () => {
      window.removeEventListener("blur", save)
      window.removeEventListener("pagehide", save)
      save()
    }
  }, [mover])

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const moves: CanvasNodeMove[] = []

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const move = {
            id: change.id,
            x: change.position.x,
            y: change.position.y,
          }
          if (change.dragging) liveMoves.current.set(change.id, move)
          else {
            liveMoves.current.delete(change.id)
            moves.push(move)
          }
          continue
        }
        if (change.type === "remove") liveMoves.current.delete(change.id)
      }

      // Only settled positions (including keyboard nudges) reach the cache.
      if (moves.length > 0) mover.move(moves)
      const selections = changes.filter((change) => change.type === "select")
      if (selections.length > 0)
        setSelectedNodes((current) => {
          const selected = new Set(current)
          for (const change of selections) {
            if (change.selected) selected.add(change.id)
            else selected.delete(change.id)
          }
          return [...selected]
        })
    },
    [mover]
  )

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]) => {
    const selections = changes.filter((change) => change.type === "select")
    if (selections.length > 0)
      setSelectedEdges((current) => {
        const selected = new Set(current)
        for (const change of selections) {
          if (change.selected) selected.add(change.id)
          else selected.delete(change.id)
        }
        return [...selected]
      })
  }, [])

  const onNodeDragStart: OnNodeDrag<CanvasFlowNode> = useCallback(
    (_event, node, nodes) => {
      const moving = nodes.length > 0 ? nodes : [node]
      const byId = new Map(latest.current.nodes.map((one) => [one.id, one]))
      dragStart.current = moving.flatMap((one) => {
        const row = byId.get(one.id)
        return row ? [{ id: row.id, x: row.x, y: row.y }] : []
      })
    },
    []
  )

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = useCallback(
    (_event, node, nodes) => {
      const before = dragStart.current
      dragStart.current = []
      // Read final positions from the gesture, not a query observer's previous
      // render. Pointer-up can precede the notification for the final move.
      const moving = new Map(
        (nodes.length > 0 ? nodes : [node]).map((one) => [one.id, one])
      )
      const after = before.flatMap((one) => {
        const final = moving.get(one.id)
        return final
          ? [{ id: one.id, x: final.position.x, y: final.position.y }]
          : []
      })
      mover.move(after)
      mover.flush()
      if (before.length === 0) return
      const moved = after.some((one, index) => {
        const was = before[index]
        return was && (was.x !== one.x || was.y !== one.y)
      })
      if (!moved) return

      const replay = (moves: CanvasNodeMove[]) => () => {
        mover.move(moves)
        mover.flush()
      }
      history.push({
        operation: "node:move",
        label: before.length > 1 ? `Move ${before.length} nodes` : "Move node",
        undo: replay(before),
        redo: replay(after),
      })
    },
    [history, mover]
  )

  /* ------------------------------------------------------------------ */
  /* Connecting                                                          */
  /* ------------------------------------------------------------------ */

  /** The model a node of this type runs when nobody has chosen one. */
  const defaultModelKeyFor = useCallback(
    (type: string): string | null =>
      type === "video_gen"
        ? (settings.data?.defaultVideoModel ?? null)
        : (settings.data?.defaultImageModel ?? null),
    [settings.data]
  )

  /**
   * The slot a new edge into `target` should carry.
   *
   * Read from the model's own descriptor, fetched through the same query
   * `useModel` uses so the two cannot diverge. A text source never gets one:
   * its contribution is a prompt prefix, not an input.
   */
  const slotFor = useCallback(
    async (source: CanvasNodeDto, target: CanvasNodeDto) => {
      if (source.type === "text") return null
      // A node nobody has opened the bar on yet has no model of its own, and
      // the default is what it would run with — so the common case (create a
      // node, drag an edge into it) resolves without a detour through the
      // edge label.
      const key = modelKeyOfNode(target) ?? defaultModelKeyFor(target.type)
      if (!key) return null
      // The node's own query — its override and wiring choose a family's
      // endpoint — so a new edge lands only in a slot that endpoint allows.
      const options = modelOptionsForNode(target, latest.current.edges)
      let descriptor: ModelDescriptor | null = null
      try {
        descriptor = await client.fetchQuery(modelDescriptorQuery(key, options))
      } catch {
        // A catalog that cannot be read is not a reason to refuse the edge;
        // it is drawn unresolved and the user labels it from the edge.
        descriptor = null
      }
      return firstFreeSlot({
        slots: descriptor ? availableSlots(descriptor, options.filled) : [],
        edges: latest.current.edges,
        targetNodeId: target.id,
        kind: contributedKind(source),
      })
    },
    [client, defaultModelKeyFor]
  )

  const connect = useCallback(
    async (sourceNodeId: string, targetNodeId: string) => {
      const graph =
        client.getQueryData<CanvasDto>(queryKeys.canvas.graph) ?? latest.current
      const byId = new Map(graph.nodes.map((one) => [one.id, one]))
      const source = byId.get(sourceNodeId)
      const target = byId.get(targetNodeId)
      if (!source || !target) return
      // Only a run takes input. Nothing can be fed into a note or a file.
      if (!isGenerateNode(target.type)) return

      const slotField = await slotFor(source, target)
      const variables = { sourceNodeId, targetNodeId, slotField }
      const created = await createEdge.mutateAsync(variables)

      // A redo mints a new row, so the undo that follows it has to delete
      // *that* row rather than the one this closure was built with.
      let edgeId = created.id
      history.push({
        operation: "edge:create",
        label: "Connect",
        undo: async () => {
          await deleteEdges.mutateAsync([edgeId])
        },
        redo: async () => {
          edgeId = (await createEdge.mutateAsync(variables)).id
        },
      })
    },
    [client, createEdge, deleteEdges, history, slotFor]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      void connect(connection.source, connection.target)
    },
    [connect]
  )

  /* ------------------------------------------------------------------ */
  /* Deleting                                                            */
  /* ------------------------------------------------------------------ */

  const onNodesDelete = useCallback(
    (deleted: CanvasFlowNode[]) => {
      const rows = deleted.map((one) => one.data.node)
      if (rows.length === 0) return
      const gone = new Set(rows.map((one) => one.id))
      // SQLite cascades these; undo has to put them back by hand.
      const orphaned = latest.current.edges.filter(
        (edge) => gone.has(edge.sourceNodeId) || gone.has(edge.targetNodeId)
      )

      let ids = new Map(rows.map((one) => [one.id, one.id]))
      void deleteNodes.mutateAsync([...ids.values()])

      history.push({
        operation: "node:delete",
        label: rows.length > 1 ? `Delete ${rows.length} nodes` : "Delete node",
        undo: async () => {
          const remade = new Map<string, string>()
          for (const row of rows) {
            const node = await createNode.mutateAsync({
              type: row.type,
              x: row.x,
              y: row.y,
              width: row.width,
              height: row.height,
              assetId: row.assetId,
              text: row.text,
              color: row.color,
            })
            // What it pointed at is not part of creating a node, and a run it
            // had already paid for must survive being taken off the board.
            if (row.generationId || row.batchId || row.pickAssetId) {
              await updateNode.mutateAsync({
                id: node.id,
                patch: {
                  generationId: row.generationId,
                  batchId: row.batchId,
                  pickAssetId: row.pickAssetId,
                },
              })
            }
            remade.set(row.id, node.id)
          }
          for (const edge of orphaned) {
            await createEdge.mutateAsync({
              sourceNodeId: remade.get(edge.sourceNodeId) ?? edge.sourceNodeId,
              targetNodeId: remade.get(edge.targetNodeId) ?? edge.targetNodeId,
              slotField: edge.slotField,
            })
          }
          ids = remade
        },
        redo: async () => {
          await deleteNodes.mutateAsync([...ids.values()])
        },
      })

      // Delete/Backspace is a bare keystroke on a surface full of them, and
      // the undo stack it lands on is invisible. This is the only thing that
      // says what happened and offers the way back.
      toast(rows.length > 1 ? `${rows.length} nodes deleted` : "Node deleted", {
        description: "The files they point at stay in the project.",
        action: { label: "Undo", onClick: () => void history.undo() },
      })
    },
    [createEdge, createNode, deleteNodes, history, updateNode]
  )

  /** Deletes edge rows as one undoable step — the Delete key and the composer's ✕. */
  const deleteEdgeRows = useCallback(
    (rows: readonly CanvasEdgeDto[]) => {
      if (rows.length === 0) return

      let ids = rows.map((one) => one.id)
      void deleteEdges.mutateAsync(ids)

      history.push({
        operation: "edge:delete",
        label: rows.length > 1 ? `Delete ${rows.length} edges` : "Delete edge",
        undo: async () => {
          const remade: string[] = []
          for (const edge of rows) {
            const made = await createEdge.mutateAsync({
              sourceNodeId: edge.sourceNodeId,
              targetNodeId: edge.targetNodeId,
              slotField: edge.slotField,
            })
            remade.push(made.id)
          }
          ids = remade
        },
        redo: async () => {
          await deleteEdges.mutateAsync(ids)
        },
      })
    },
    [createEdge, deleteEdges, history]
  )

  const onEdgesDelete = useCallback(
    (deleted: CanvasFlowEdge[]) =>
      deleteEdgeRows(
        deleted.flatMap((one) => (one.data ? [one.data.edge] : []))
      ),
    [deleteEdgeRows]
  )

  /** The composer's ✕ on a note: its wire(s) into `targetNodeId`, undoably. */
  const disconnectNote = useCallback(
    (noteNodeId: string, targetNodeId: string) =>
      deleteEdgeRows(
        latest.current.edges.filter(
          (edge) =>
            edge.sourceNodeId === noteNodeId &&
            edge.targetNodeId === targetNodeId
        )
      ),
    [deleteEdgeRows]
  )

  /** A reference thumbnail's ✕: these wires, undoably. */
  const disconnectEdges = useCallback(
    (edgeIds: readonly string[]) => {
      const ids = new Set(edgeIds)
      deleteEdgeRows(latest.current.edges.filter((edge) => ids.has(edge.id)))
    },
    [deleteEdgeRows]
  )

  /* ------------------------------------------------------------------ */
  /* Adding                                                              */
  /* ------------------------------------------------------------------ */

  const addNode = useCallback(
    async (
      type: CanvasNodeType,
      position: { x: number; y: number },
      extra: { assetId?: string | null; ratio?: AspectRatio | null } = {}
    ) => {
      // A media node is as tall as the picture it holds, from the moment it
      // lands — the import already read the asset's dimensions, so there is
      // nothing to guess.
      const size = defaultNodeSize(type, extra.ratio ?? null)
      const node = await createNode.mutateAsync({
        type,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        assetId: extra.assetId ?? null,
      })
      let id = node.id
      history.push({
        operation: "node:create",
        label: "Add node",
        undo: async () => {
          await deleteNodes.mutateAsync([id])
        },
        redo: async () => {
          const again = await createNode.mutateAsync({
            type,
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            assetId: extra.assetId ?? null,
          })
          id = again.id
        },
      })
      return node
    },
    [createNode, deleteNodes, history]
  )

  /** The "+" on a node's side: a new node one gap over, already connected. */
  const spawn = useCallback(
    (
      origin: CanvasNodeDto,
      direction: "left" | "right",
      type: CanvasNodeType
    ) =>
      void (async () => {
        const size = defaultNodeSize(type)
        const point = spawnPosition({
          origin: boxOf(origin),
          direction,
          size,
          occupied: latest.current.nodes.map(boxOf),
        })
        const node = await addNode(type, point)
        await connect(
          direction === "right" ? origin.id : node.id,
          direction === "right" ? node.id : origin.id
        )
      })(),
    [addNode, connect]
  )

  /** The surface's own box: the drop point, and the viewport's centre. */
  const wrapper = useRef<HTMLElement | null>(null)

  /** The centre of what the user is looking at, for the rail's Add. */
  const viewportCentre = useCallback(() => {
    const element = wrapper.current
    if (!element) return { x: 0, y: 0 }
    const rect = element.getBoundingClientRect()
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
  }, [screenToFlowPosition])

  const addFromRail = useCallback(
    (type: CanvasNodeType) => {
      const size = defaultNodeSize(type)
      void addNode(type, dropPosition(viewportCentre(), size))
    },
    [addNode, viewportCentre]
  )

  /* ------------------------------------------------------------------ */
  /* Dropping                                                            */
  /* ------------------------------------------------------------------ */

  /** Files from Finder or Explorer: import them, then place what came back. */
  const importAt = useCallback(
    (paths: string[], point: { x: number; y: number }) => {
      if (paths.length === 0) return
      importAssets.mutate(
        { paths, containerId },
        {
          onSuccess: (result) => {
            const points = dropPositions(
              point,
              defaultNodeSize("media"),
              result.assets.length
            )
            result.assets.forEach((asset, index) => {
              void addNode("media", points[index] ?? point, {
                assetId: asset.id,
                ratio: aspectRatioOf(asset.width, asset.height),
              })
            })
          },
        }
      )
    },
    [addNode, containerId, importAssets]
  )

  const onFileDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setFileDropActive(false)
      const point = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      importAt(pathsForFiles(Array.from(event.dataTransfer.files)), point)
    },
    [importAt, screenToFlowPosition]
  )

  const onImportClick = useCallback(() => {
    chooseFiles.mutate(undefined, {
      onSuccess: (paths) => importAt(paths, viewportCentre()),
    })
  }, [chooseFiles, importAt, viewportCentre])

  /**
   * An asset dragged in from the sidebar.
   *
   * The same dnd-kit payload the board uses (`AssetDragData`), so one drag
   * gesture works on both; where the board files it into a container, the
   * canvas puts it on the surface where the pointer let go.
   */
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: CANVAS_DROPPABLE_ID,
    data: { type: "canvas" },
  })

  useDndMonitor({
    onDragEnd: (event) => {
      if (event.over?.id !== CANVAS_DROPPABLE_ID) return
      const data = event.active.data.current
      if (!isAssetDragData(data)) return
      const rect = wrapper.current?.getBoundingClientRect()
      const activator = event.activatorEvent as Partial<MouseEvent>
      if (!rect || typeof activator.clientX !== "number") return
      const point = screenToFlowPosition({
        x: activator.clientX + event.delta.x,
        y: (activator.clientY ?? 0) + event.delta.y,
      })
      const size = defaultNodeSize("media")
      void addNode("media", dropPosition(point, size), {
        assetId: data.assetId,
      })
    },
  })

  /* ------------------------------------------------------------------ */
  /* Picking                                                             */
  /* ------------------------------------------------------------------ */

  const pick = useCallback(
    (node: CanvasNodeDto, assetId: string) => {
      const previous = node.pickAssetId
      if (previous === assetId) return
      pickNode.mutate({ id: node.id, assetId })
      history.push({
        operation: "node:pick",
        label: "Change pick",
        undo: () => {
          // There is no "unpick" channel, and there does not need to be: a
          // pick is a nullable column and the patch says so.
          if (previous === null) {
            updateNode.mutate({ id: node.id, patch: { pickAssetId: null } })
            return
          }
          pickNode.mutate({ id: node.id, assetId: previous })
        },
        redo: () => pickNode.mutate({ id: node.id, assetId }),
      })
    },
    [history, pickNode, updateNode]
  )

  /* ------------------------------------------------------------------ */
  /* Branching                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * "Branch from this run" — a sibling node, not a child.
   *
   * A branch is another take on the same idea, so it is a fresh generate node
   * one gap over with the parent's prompt and model already in its draft, and
   * deliberately *no* edge to the run it came from: an edge would feed the old
   * output in as a reference, which is a different thing entirely.
   *
   * ⛔ It spends nothing. The new node is empty until its Run is pressed.
   */
  const branch = useCallback(
    (origin: CanvasNodeDto, generation: GenerationDto) =>
      void (async () => {
        const type: CanvasNodeType =
          generation.kind === "video" ? "video_gen" : "image_gen"
        const size = defaultNodeSize(type)
        const point = spawnPosition({
          origin: boxOf(origin),
          direction: "right",
          size,
          occupied: latest.current.nodes.map(boxOf),
        })
        const node = await addNode(type, point)
        seedPromptDraft(node.id, {
          prompt: generation.prompt ?? "",
          modelKey: modelKeyOf(generation),
        })
        setSelectedNodes([node.id])
        setSelectedEdges([])
      })().catch((error: unknown) =>
        toast.error("Could not branch from that run", {
          description:
            error instanceof Error
              ? error.message
              : "The node was not created.",
        })
      ),
    [addNode]
  )

  /** The lineage names a run; the canvas selects the node that stands for it. */
  const selectGeneration = useCallback((generationId: string) => {
    const match = latest.current.nodes.find(
      (node) => node.generationId === generationId
    )
    if (!match) return
    setSelectedNodes([match.id])
    setSelectedEdges([])
  }, [])

  /** A note double-clicked in the composer: the canvas selects it. */
  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodes([nodeId])
    setSelectedEdges([])
  }, [])

  /** The note the composer's pointer is over, lit up on the surface. */
  const [highlightedNote, setHighlightedNote] = useState<string | null>(null)

  /* ------------------------------------------------------------------ */
  /* Migration                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * ⛔ Offered, never automatic.
   *
   * Deriving a layout is a write, and opening a project must not rewrite it —
   * so a project that predates the canvas opens empty with this notice, and
   * the migration happens on the click and on nothing else. A failure writes
   * nothing, so the notice stays and the offer is still good.
   */
  const migrate = useCanvasMigrate()
  const migrateMutate = migrate.mutate
  const hasHistory = (generations.data?.total ?? 0) > 0
  const offerMigration =
    !migrationDismissed &&
    canvasQuery.isSuccess &&
    canvas.nodes.length === 0 &&
    hasHistory

  /**
   * A brand-new project used to open on a dot grid and nothing else: no
   * onboarding, and no hint that the rail's "+" is where a canvas starts. This
   * is the smallest honest answer — what this surface is for, and the one
   * action that begins it.
   */
  const showEmptyState =
    canvasQuery.isSuccess && canvas.nodes.length === 0 && !offerMigration

  /* ------------------------------------------------------------------ */
  /* Undo and redo                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * ⌘Z and ⇧⌘Z, the two every editor has.
   *
   * ⛔ They replay canvas operations only — `use-canvas-history.ts` refuses
   * anything else, so a keystroke can never re-submit a run. Form tags are
   * left out on purpose: inside a note or the prompt box, undo belongs to the
   * text box the caret is in.
   */
  const undo = history.undo
  const redo = history.redo
  useHotkeys(
    "mod+z",
    (event) => {
      event.preventDefault()
      void undo()
    },
    [undo]
  )
  useHotkeys(
    "mod+shift+z",
    (event) => {
      event.preventDefault()
      void redo()
    },
    [redo]
  )

  /* ------------------------------------------------------------------ */
  /* The surface                                                         */
  /* ------------------------------------------------------------------ */

  // Actions need current mutation/history closures, but a changed history
  // label or unrelated row must not broadcast a render to every node body.
  const actions = useRef({
    spawn,
    pick,
    branch,
    selectGeneration,
    selectNode,
    disconnectNote,
    disconnectEdges,
  })
  const noteDrafts = useMemo(() => createNoteDrafts(), [])
  useEffect(() => {
    const live = new Set(canvas.nodes.map((node) => node.id))
    noteDrafts.retain(live)
  }, [canvas.nodes, noteDrafts])
  useEffect(() => {
    actions.current = {
      spawn,
      pick,
      branch,
      selectGeneration,
      selectNode,
      disconnectNote,
      disconnectEdges,
    }
  }, [
    spawn,
    pick,
    branch,
    selectGeneration,
    selectNode,
    disconnectNote,
    disconnectEdges,
  ])
  const surface: CanvasSurface = useMemo(
    () => ({
      containerId,
      noteDrafts,
      managesDefaultPicks: true,
      spawn: (...args) => actions.current.spawn(...args),
      pick: (...args) => actions.current.pick(...args),
      branch: (...args) => actions.current.branch(...args),
      selectGeneration: (...args) => actions.current.selectGeneration(...args),
      selectNode: (...args) => actions.current.selectNode(...args),
      disconnectNote: (...args) => actions.current.disconnectNote(...args),
      disconnectEdges: (...args) => actions.current.disconnectEdges(...args),
      // A state setter is already stable; no ref needed.
      highlightNote: setHighlightedNote,
    }),
    [containerId, noteDrafts]
  )

  /** The prompt bar belongs to exactly one selected generate node. */
  const selectedGenerateNode =
    selectedNodes.length === 1
      ? (canvas.nodes.find(
          (node) => node.id === selectedNodes[0] && isGenerateNode(node.type)
        ) ?? null)
      : null

  /**
   * The composer's hover, drawn onto the surface by attribute rather than by
   * re-rendering React Flow: the note and the wire(s) from it into the
   * selected node get `data-prompt-highlight`, which `react-flow.css` styles.
   * Going through the flow nodes would rebuild the caches every body reads.
   */
  const highlightTarget = selectedGenerateNode?.id ?? null
  useEffect(() => {
    const root = wrapper.current
    if (!root || !highlightedNote || !highlightTarget) return
    const lit: Element[] = []
    const noteElement = root.querySelector(
      `.react-flow__node[data-id="${CSS.escape(highlightedNote)}"]`
    )
    if (noteElement) lit.push(noteElement)
    for (const edge of canvas.edges) {
      if (
        edge.sourceNodeId !== highlightedNote ||
        edge.targetNodeId !== highlightTarget
      )
        continue
      const edgeElement = root.querySelector(
        `.react-flow__edge[data-id="${CSS.escape(edge.id)}"]`
      )
      if (edgeElement) lit.push(edgeElement)
    }
    for (const element of lit) element.setAttribute("data-prompt-highlight", "")
    return () => {
      for (const element of lit)
        element.removeAttribute("data-prompt-highlight")
    }
  }, [canvas.edges, highlightTarget, highlightedNote])

  const defaultModelKey = selectedGenerateNode
    ? defaultModelKeyFor(selectedGenerateNode.type)
    : null

  return (
    <CanvasSurfaceProvider value={surface}>
      {canvas.nodes
        .filter(
          (node) =>
            isGenerateNode(node.type) &&
            node.pickAssetId === null &&
            (node.generationId !== null || node.batchId !== null)
        )
        .map((node) => (
          <DefaultCanvasPick
            key={node.id}
            node={node}
            containerId={containerId}
          />
        ))}
      <section
        ref={(element) => {
          wrapper.current = element
          setDroppableRef(element)
        }}
        data-testid="canvas-surface"
        data-file-drop={fileDropActive || undefined}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          // A file drag only; an in-app asset drag is dnd-kit's business.
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          setFileDropActive(true)
        }}
        onDragLeave={(event: DragEvent<HTMLDivElement>) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setFileDropActive(false)
        }}
        onDrop={onFileDrop}
      >
        <WorkflowLibrary canvas={canvas} />
        <CanvasRail
          mode={mode}
          onModeChange={setMode}
          onAdd={addFromRail}
          onImport={onImportClick}
          importing={importAssets.isPending || chooseFiles.isPending}
          onUndo={() => void history.undo()}
          onRedo={() => void history.redo()}
          canUndo={history.canUndo && !history.busy}
          canRedo={history.canRedo && !history.busy}
          undoLabel={history.undoLabel}
          redoLabel={history.redoLabel}
        />

        {offerMigration ? (
          <Alert
            data-testid="canvas-migration-offer"
            className="absolute top-3 right-3 z-10 w-80"
          >
            <AlertTitle>This project was made before the canvas</AlertTitle>
            <AlertDescription>
              {migrate.isError
                ? `That did not work: ${migrate.error.message} Nothing was written, so it can be tried again.`
                : "Its runs and imports can be laid out here. Nothing is written until you ask."}
            </AlertDescription>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={migrate.isPending}
                onClick={() => migrateMutate()}
              >
                {migrate.isPending ? "Laying out…" : "Lay out my existing work"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMigrationDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </Alert>
        ) : null}

        {canvasQuery.error ? (
          <p className="p-4 text-sm text-destructive">
            {canvasQuery.error.message}
          </p>
        ) : null}

        {showEmptyState ? (
          <div
            data-testid="canvas-empty-state"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8"
          >
            <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium">Nothing on the canvas yet</p>
              <p className="text-sm text-muted-foreground">
                Add a node to write a prompt, or drop files from Finder anywhere
                on this surface to bring them in.
              </p>
              {/* ⛔ Adds an empty node. Nothing here starts a run. */}
              <Button size="sm" onClick={() => addFromRail("image_gen")}>
                Add a node
              </Button>
            </div>
          </div>
        ) : null}

        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          defaultNodes={INITIAL_NODES}
          onlyRenderVisibleElements
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          /* Delete takes the selection off the canvas, and nothing else: the
             asset and the generation stay in the project. */
          deleteKeyCode={["Delete", "Backspace"]}
          /* Space and drag pans, the wheel zooms, Shift and drag box-selects.
             The rail's select mode swaps the first two round. */
          panOnDrag={mode === "pan"}
          selectionOnDrag={mode === "select"}
          panActivationKeyCode="Space"
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Meta", "Control"]}
          zoomOnScroll
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={2}
          fitView
          proOptions={{ hideAttribution: false }}
          className="min-h-0 flex-1"
        >
          <Background />
          <MiniMap position="bottom-right" pannable zoomable />
          {selectedGenerateNode ? (
            <NodeToolbar
              nodeId={selectedGenerateNode.id}
              isVisible
              position={Position.Bottom}
              /* Anchored to the node's left edge rather than its centre: a
                 centred toolbar moves by half of any width change, and this
                 bar's width is the one thing the user must be able to rely
                 on while reaching for a control. */
              align="start"
              offset={16}
              // Outside the canvas's pan and drag: d3-zoom swallows a
              // mousedown anywhere else, and a control that opens on
              // mousedown (the provider override's Select) never opened.
              className="nopan nodrag"
            >
              <PromptBar
                node={selectedGenerateNode}
                canvas={canvas}
                defaultModelKey={defaultModelKey}
              />
            </NodeToolbar>
          ) : null}
        </ReactFlow>

        {canvasQuery.isPending ? (
          <Skeleton className="absolute inset-4 rounded-lg" />
        ) : null}
      </section>
    </CanvasSurfaceProvider>
  )
}

export interface CanvasProps {
  /** The board the canvas imports into, and reads runs and outputs from. */
  containerId: string | null
}

/**
 * Outside Electron there is no bridge, no project and nothing to draw — the
 * same answer the shell gives, for the same reason.
 */
export function Canvas(props: CanvasProps) {
  const bridge = useBridge()

  if (bridge === null) {
    return <Skeleton className="m-4 min-h-0 flex-1 rounded-lg" />
  }

  if (!bridge) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          OpenDirect runs in its desktop window. Start it with{" "}
          <code className="font-mono">pnpm dev:desktop</code>.
        </p>
      </main>
    )
  }

  return (
    <ReactFlowProvider>
      <CanvasSurfaceInner {...props} />
    </ReactFlowProvider>
  )
}
