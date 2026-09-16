/**
 * The shapes React Flow is handed.
 *
 * React Flow's nodes and edges are rendering state, and the row is the truth;
 * so each one carries exactly one thing in `data` — the row it was derived
 * from — and nothing is copied out of it. A node's position and size are the
 * two exceptions, because they are what React Flow itself reads to draw with.
 */
import type { Edge, Node } from "@xyflow/react"
import type {
  CanvasEdgeDto,
  CanvasNodeDto,
  CanvasNodeType,
} from "@opendirect/contract"

export type CanvasFlowNode = Node<{ node: CanvasNodeDto }, CanvasNodeType>

export type CanvasFlowEdge = Edge<
  {
    edge: CanvasEdgeDto
    /**
     * The model whose slots the label offers, or null when the target has not
     * run yet and therefore has no model to ask.
     */
    targetModelKey: string | null
  },
  "reference"
>
