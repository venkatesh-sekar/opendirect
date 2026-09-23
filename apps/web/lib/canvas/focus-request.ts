import type { CanvasNodeDto } from "@opendirect/contract"

/**
 * A one-shot "look at this" for the canvas, from outside it.
 *
 * The id is either a node — a seeded generate node the canvas should centre on
 * — or a container, from `/canvas/?focus=<id>`, whose nodes it should frame.
 * The canvas may not have mounted, or loaded its nodes, when the request is
 * made, so it is held here until the canvas can answer it.
 */
let requested: string | null = null
const listeners = new Set<() => void>()
export function requestCanvasFocus(id: string) {
  requested = id
  for (const listener of listeners) listener()
}
export function subscribeCanvasFocus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function pendingCanvasFocus() {
  return requested
}
export function clearCanvasFocus(id: string) {
  if (requested === id) requested = null
}

export interface CanvasFocusTarget {
  /** A node is centred; a container's nodes are fitted into view together. */
  kind: "node" | "container"
  ids: string[]
}

/**
 * What a focus request points at on this canvas, or null when nothing does.
 *
 * A node is "in" a container when it is tagged with it or when its run was
 * filed there — a node that has run carries its container on the generation
 * even when its own tag was never set.
 */
export function resolveCanvasFocus(
  nodes: readonly Pick<CanvasNodeDto, "id" | "containerId" | "generation">[],
  id: string
): CanvasFocusTarget | null {
  if (nodes.some((node) => node.id === id)) return { kind: "node", ids: [id] }
  const framed = nodes
    .filter(
      (node) => node.containerId === id || node.generation?.containerId === id
    )
    .map((node) => node.id)
  return framed.length > 0 ? { kind: "container", ids: framed } : null
}
