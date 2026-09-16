"use client"

/**
 * What a node needs from the surface it is sitting on.
 *
 * A custom React Flow node is rendered by React Flow, not by us, so there is
 * no prop path from `<Canvas/>` down to a node body. The things a node
 * genuinely cannot answer alone travel through this context instead: the whole
 * canvas (a "+" has to know what space is already occupied), the container the
 * workspace is pointed at, the undo stack (component state that lives on the
 * surface), and the spawn action itself, which creates a node *and* an edge
 * and has to record both as one entry.
 *
 * It is deliberately nullable. A node body rendered on its own — in a test, or
 * in a preview — is still a valid thing to render; it simply has no "+".
 *
 * ⛔ Nothing reachable from here submits a generation.
 */
import { createContext, useContext } from "react"
import type {
  CanvasDto,
  CanvasNodeDto,
  CanvasNodeType,
  GenerationDto,
} from "@opendirect/contract"

import type { CanvasHistory } from "@/hooks/use-canvas-history"

export interface CanvasSurface {
  canvas: CanvasDto
  /**
   * The container the workspace is pointed at — where imports land and where
   * runs are listed from.
   *
   * A generate node needs it because a node is not always able to name its own
   * container: a batch of siblings has no single `generationId`, and a run that
   * was pruned leaves the node with none at all. Without this the node would go
   * blank rather than show the tiles it still has.
   */
  containerId: string | null
  history: CanvasHistory
  /**
   * Creates `type` one gap to the `direction` side of `origin` and connects
   * the two, source-to-target in the direction the "+" pointed.
   */
  spawn: (
    origin: CanvasNodeDto,
    direction: "left" | "right",
    type: CanvasNodeType
  ) => void
  /** Which tile of a batch downstream edges use. On the undo stack. */
  pick: (node: CanvasNodeDto, assetId: string) => void
  /**
   * "Branch from this run": a fresh generate node beside `origin`, with its
   * prompt and model already filled in from `generation`.
   *
   * ⛔ It seeds a composition and stops. Nothing here submits a run — the new
   * node's bar still has a Run button the user has to press.
   */
  branch: (origin: CanvasNodeDto, generation: GenerationDto) => void
  /**
   * Selects the node that stands for a run — how the details panel's lineage
   * moves the canvas. A run with no node on this canvas selects nothing.
   */
  selectGeneration: (generationId: string) => void
}

const CanvasSurfaceContext = createContext<CanvasSurface | null>(null)

export const CanvasSurfaceProvider = CanvasSurfaceContext.Provider

/** Null outside a `<Canvas/>`; every caller degrades rather than throwing. */
export function useCanvasSurface(): CanvasSurface | null {
  return useContext(CanvasSurfaceContext)
}
