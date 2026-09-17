"use client"

/**
 * The canvas's persisted half.
 *
 * The line between the two stores is the design's: React Flow owns the
 * transient state — viewport, selection, the drag in flight — and none of it
 * comes through here. This owns the rows: nodes, edges, positions and picks,
 * with the query cache as the source of truth for what gets rendered.
 *
 * Two writing speeds, and only two:
 *
 * - **Settled positions are debounced.** Live drag frames stay in React Flow.
 *   At gesture end `useCanvasNodeMover` paints the final positions into the
 *   cache and flushes one `canvas:node:move`. Keyboard nudges are coalesced
 *   after ~400ms of quiet. Group moves travel together.
 * - **Everything else is written immediately.** Node adds, deletes, edge
 *   changes and pick changes are one call each, the moment they happen.
 *
 * The cheap optimistic updates are here too — a pick, a note's text, a
 * deletion — because the answer is already known locally and a round trip
 * before the canvas repaints would be visible. A create is not optimistic:
 * only the main process can mint the row's id, and a node that exists under a
 * temporary id is a node an edge can be drawn from and then orphaned.
 *
 * ⛔ Nothing in this file submits a generation. An edge is a reference, and
 * drawing one never starts a run; `useSubmitGeneration` / `useSubmitBatch`
 * are still the only path to a paid call, and still only from a click.
 */
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  CanvasDto,
  CanvasEdgeDto,
  CanvasNodeDto,
  CanvasNodeMove,
  CanvasNodePatch,
  CanvasNodeType,
} from "@opendirect/contract"

import { invoke, isBridgeAvailable } from "@/lib/ipc"
import { queryKeys } from "./query-keys"

/** How long a drag has to be still before its positions are written. */
export const MOVE_DEBOUNCE_MS = 400

/**
 * The whole surface, in one query.
 *
 * Outside Electron there is no bridge and therefore no project; the query
 * stays disabled and the canvas renders its placeholder, the same way the
 * shell already handles a missing bridge.
 */
export function useCanvas(enabled = true): UseQueryResult<CanvasDto> {
  return useQuery({
    queryKey: queryKeys.canvas.graph,
    queryFn: () => invoke("canvas:get"),
    enabled: enabled && isBridgeAvailable(),
  })
}

/**
 * Every canvas write refetches the surface: it is one query, it is small, and
 * a node add can move an edge's endpoints in ways a patch would have to guess.
 */
function useInvalidateCanvas(): () => void {
  const client = useQueryClient()
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.canvas.all })
  }, [client])
}

/** Rewrites the cached surface in place, when there is one to rewrite. */
function editCanvas(
  client: QueryClient,
  edit: (canvas: CanvasDto) => CanvasDto
): CanvasDto | undefined {
  const current = client.getQueryData<CanvasDto>(queryKeys.canvas.graph)
  if (!current) return undefined
  client.setQueryData(queryKeys.canvas.graph, edit(current))
  return current
}

function mapNode(
  canvas: CanvasDto,
  id: string,
  edit: (node: CanvasNodeDto) => CanvasNodeDto
): CanvasDto {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (node.id === id ? edit(node) : node)),
  }
}

export interface CreateCanvasNodeVariables {
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  assetId?: string | null
  text?: string | null
  color?: string | null
}

export function useCreateCanvasNode(): UseMutationResult<
  CanvasNodeDto,
  Error,
  CreateCanvasNodeVariables
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (variables: CreateCanvasNodeVariables) =>
      invoke("canvas:node:create", variables),
    // The response already carries the authoritative row. Paint it without
    // waiting for a second IPC round trip, and make it available to spawn's
    // immediately following connection operation.
    onSuccess: (node) => {
      editCanvas(client, (canvas) => ({
        ...canvas,
        nodes: canvas.nodes.some((one) => one.id === node.id)
          ? canvas.nodes.map((one) => (one.id === node.id ? node : one))
          : [...canvas.nodes, node],
      }))
    },
    onSettled,
  })
}

export interface UpdateCanvasNodeVariables {
  id: string
  patch: CanvasNodePatch
}

/**
 * A note's text, a sticky's colour, a resize the user typed rather than
 * dragged. Applied to the cache first — the field the user just edited is the
 * one thing they must not see flicker — and rolled back if the write fails.
 */
export function useUpdateCanvasNode(): UseMutationResult<
  CanvasNodeDto,
  Error,
  UpdateCanvasNodeVariables,
  { previous?: CanvasDto }
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (variables: UpdateCanvasNodeVariables) =>
      invoke("canvas:node:update", variables),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: queryKeys.canvas.graph })
      const previous = editCanvas(client, (canvas) =>
        mapNode(canvas, id, (node) => ({ ...node, ...patch }))
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.canvas.graph, context.previous)
      }
    },
    onSettled,
  })
}

/**
 * Positions, in bulk.
 *
 * The raw channel. Prefer `useCanvasNodeMover`, which is what a drag should
 * use; this is here for a caller that already has one settled position and
 * wants it written now.
 */
export function useMoveCanvasNodes(): UseMutationResult<
  { ok: true },
  Error,
  CanvasNodeMove[]
> {
  const onError = useInvalidateCanvas()
  return useMutation({
    mutationFn: (moves: CanvasNodeMove[]) =>
      invoke("canvas:node:move", { moves }),
    // No invalidation on success: the cache already holds the positions the
    // write was made from, and a refetch mid-gesture would fight the drag.
    onError,
  })
}

export interface CanvasNodeMover {
  /**
   * Applies the positions to the cache now, and schedules one write for when
   * the gesture goes quiet. Calling it again before then extends the quiet
   * period and coalesces the nodes into the same call.
   */
  move: (moves: readonly CanvasNodeMove[]) => void
  /** Writes whatever is pending immediately — drag end, blur, unmount. */
  flush: () => void
}

/**
 * The debounced, coalescing position writer.
 *
 * One `canvas:node:move` per gesture, carrying every node the gesture touched
 * at its final position. A node moved twice inside the window is written once:
 * the map is keyed by id, so the last position wins.
 */
export function useCanvasNodeMover(
  debounceMs: number = MOVE_DEBOUNCE_MS
): CanvasNodeMover {
  const client = useQueryClient()
  const mutation = useMoveCanvasNodes()
  const pending = useRef(new Map<string, CanvasNodeMove>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mutate = mutation.mutate
  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current.size === 0) return
    const moves = [...pending.current.values()]
    pending.current = new Map()
    mutate(moves)
  }, [mutate])

  const move = useCallback(
    (moves: readonly CanvasNodeMove[]) => {
      if (moves.length === 0) return
      for (const one of moves) pending.current.set(one.id, one)

      const byId = new Map(moves.map((one) => [one.id, one]))
      editCanvas(client, (canvas) => ({
        ...canvas,
        nodes: canvas.nodes.map((node) => {
          const next = byId.get(node.id)
          return next ? { ...node, ...next } : node
        }),
      }))

      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, debounceMs)
    },
    [client, debounceMs, flush]
  )

  // A window closed, or a canvas unmounted, mid-gesture still owes the
  // database the position the user left the node at.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => () => flushRef.current(), [])

  return useMemo(() => ({ move, flush }), [move, flush])
}

/**
 * Removes nodes and their edges.
 *
 * ⛔ Not the assets and not the generations — those stay in the project,
 * reachable from the sidebar container they were filed under. Deleting a node
 * is taking it off the board, not destroying something that was paid for.
 */
export function useDeleteCanvasNodes(): UseMutationResult<
  { ok: true },
  Error,
  string[],
  { previous?: CanvasDto }
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (ids: string[]) => invoke("canvas:node:delete", { ids }),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: queryKeys.canvas.graph })
      const gone = new Set(ids)
      const previous = editCanvas(client, (canvas) => ({
        nodes: canvas.nodes.filter((node) => !gone.has(node.id)),
        // The edges go with them, exactly as the foreign key does in SQLite.
        edges: canvas.edges.filter(
          (edge) => !gone.has(edge.sourceNodeId) && !gone.has(edge.targetNodeId)
        ),
      }))
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.canvas.graph, context.previous)
      }
    },
    onSettled,
  })
}

export interface PickCanvasNodeVariables {
  id: string
  assetId: string
}

/**
 * Chooses which tile of a batch downstream edges use.
 *
 * ⛔ Re-runs nothing. Changing a pick changes what the *next* run downstream
 * would be given, and nothing else; no node is marked stale and no job is
 * queued.
 */
export function usePickCanvasNode(): UseMutationResult<
  CanvasNodeDto,
  Error,
  PickCanvasNodeVariables,
  { previous?: CanvasDto }
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (variables: PickCanvasNodeVariables) =>
      invoke("canvas:node:pick", variables),
    onMutate: async ({ id, assetId }) => {
      await client.cancelQueries({ queryKey: queryKeys.canvas.graph })
      const previous = editCanvas(client, (canvas) =>
        mapNode(canvas, id, (node) => ({ ...node, pickAssetId: assetId }))
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.canvas.graph, context.previous)
      }
    },
    onSettled,
  })
}

export interface CreateCanvasEdgeVariables {
  sourceNodeId: string
  targetNodeId: string
  /** Null for a text edge, which prepends to the prompt instead. */
  slotField?: string | null
}

export function useCreateCanvasEdge(): UseMutationResult<
  CanvasEdgeDto,
  Error,
  CreateCanvasEdgeVariables
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (variables: CreateCanvasEdgeVariables) =>
      invoke("canvas:edge:create", variables),
    onSuccess: (edge) => {
      editCanvas(client, (canvas) => ({
        ...canvas,
        edges: canvas.edges.some((one) => one.id === edge.id)
          ? canvas.edges.map((one) => (one.id === edge.id ? edge : one))
          : [...canvas.edges, edge],
      }))
    },
    onSettled,
  })
}

export interface UpdateCanvasEdgeVariables {
  id: string
  slotField: string | null
}

/** Re-labels an edge with a different input slot of the same model. */
export function useUpdateCanvasEdge(): UseMutationResult<
  CanvasEdgeDto,
  Error,
  UpdateCanvasEdgeVariables,
  { previous?: CanvasDto }
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (variables: UpdateCanvasEdgeVariables) =>
      invoke("canvas:edge:update", variables),
    onMutate: async ({ id, slotField }) => {
      await client.cancelQueries({ queryKey: queryKeys.canvas.graph })
      const previous = editCanvas(client, (canvas) => ({
        ...canvas,
        edges: canvas.edges.map((edge) =>
          edge.id === id ? { ...edge, slotField } : edge
        ),
      }))
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.canvas.graph, context.previous)
      }
    },
    onSettled,
  })
}

export function useDeleteCanvasEdges(): UseMutationResult<
  { ok: true },
  Error,
  string[],
  { previous?: CanvasDto }
> {
  const client = useQueryClient()
  const onSettled = useInvalidateCanvas()
  return useMutation({
    mutationFn: (ids: string[]) => invoke("canvas:edge:delete", { ids }),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: queryKeys.canvas.graph })
      const gone = new Set(ids)
      const previous = editCanvas(client, (canvas) => ({
        ...canvas,
        edges: canvas.edges.filter((edge) => !gone.has(edge.id)),
      }))
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.canvas.graph, context.previous)
      }
    },
    onSettled,
  })
}

/**
 * Lays an existing project's lineage out as a canvas, for a project that
 * predates it — the "Lay out my existing work" offer.
 *
 * Idempotent by intent: a project that already has canvas rows is answered
 * with the canvas it has. A migration that throws writes nothing, so it can
 * be offered again.
 */
export function useCanvasMigrate(): UseMutationResult<CanvasDto, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => invoke("canvas:migrate"),
    onSuccess: (canvas) => {
      client.setQueryData(queryKeys.canvas.graph, canvas)
    },
  })
}
