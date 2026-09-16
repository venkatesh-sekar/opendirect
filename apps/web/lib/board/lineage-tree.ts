/**
 * Flattening a lineage payload into rows a list can draw.
 *
 * `generations:lineage` answers with three flat arrays — ancestors, the run
 * itself, descendants — because that is what the walk in main produces. A
 * branch history reads as a tree, though, so the depth of each row is worked
 * out here, once, and asserted directly rather than being re-derived by the
 * component while it renders.
 *
 * Two rules the payload cannot guarantee on its own: a generation appears
 * exactly once however many times the walk mentions it, and a row whose parent
 * is missing from the payload still appears — at the root, with no edge — so a
 * pruned history never hides a run.
 */
import type { GenerationDto, Lineage } from "@opendirect/contract"

export interface LineageNode {
  generation: GenerationDto
  /** Generations between this one and the oldest ancestor in the payload. */
  depth: number
  /** True for the run the panel is open on. */
  current: boolean
  /** Parent id, but only when that parent is itself in `nodes`. */
  parentId: string | null
}

export interface LineageEdge {
  from: string
  to: string
}

export interface LineageTree {
  nodes: LineageNode[]
  edges: LineageEdge[]
}

export function buildLineageTree(lineage: Lineage): LineageTree {
  const ordered: { generation: GenerationDto; current: boolean }[] = [
    ...lineage.ancestors.map((generation) => ({ generation, current: false })),
    { generation: lineage.generation, current: true },
    ...lineage.descendants.map((generation) => ({
      generation,
      current: false,
    })),
  ]

  const nodes: LineageNode[] = []
  const depths = new Map<string, number>()
  const seen = new Set<string>()
  const edges: LineageEdge[] = []

  for (const { generation, current } of ordered) {
    if (seen.has(generation.id)) continue
    seen.add(generation.id)

    const parentId = generation.parentGenerationId
    const parentDepth = parentId === null ? undefined : depths.get(parentId)
    const depth = parentDepth === undefined ? 0 : parentDepth + 1
    depths.set(generation.id, depth)

    const resolvedParent = parentDepth === undefined ? null : parentId
    nodes.push({ generation, depth, current, parentId: resolvedParent })
    if (resolvedParent !== null) {
      edges.push({ from: resolvedParent, to: generation.id })
    }
  }

  return { nodes, edges }
}
