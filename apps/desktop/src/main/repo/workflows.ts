import { randomUUID } from "node:crypto"
import type { PromptBlock, PromptRecipe, Workflow } from "@opendirect/contract"
import type { ProjectDatabase } from "../db/client"
import { createNode, createEdge, getCanvas } from "./canvas"

/**
 * Append a portable graph in one transaction, remapping every node ID.
 *
 * Every new ID is chosen before any node is written, because a recipe's note
 * blocks may name a node that comes later in `workflow.nodes`.
 */
export function importWorkflow(
  db: ProjectDatabase,
  projectId: string,
  workflow: Workflow
) {
  return db.transaction(() => {
    const existing = getCanvas(db, projectId)
    const offset = existing.nodes.length
      ? Math.max(...existing.nodes.map((n) => n.x + n.width)) + 120
      : 0
    const left = Math.min(...workflow.nodes.map((n) => n.x))
    const ids = new Map(workflow.nodes.map((n) => [n.id, randomUUID()]))
    for (const node of workflow.nodes)
      createNode(db, {
        id: ids.get(node.id),
        projectId: projectId,
        type: node.type,
        x: node.x - left + offset,
        y: node.y,
        width: node.width,
        height: node.height,
        text: node.recipe
          ? JSON.stringify(remapRecipe(node.recipe, ids))
          : node.text,
        modelKey: node.recipe?.modelKey ?? null,
      })
    for (const edge of workflow.edges)
      createEdge(db, {
        projectId: projectId,
        sourceNodeId: ids.get(edge.sourceNodeId)!,
        targetNodeId: ids.get(edge.targetNodeId)!,
        slotField: edge.slotField,
      })
    return getCanvas(db, projectId)
  })
}

/** Note blocks name nodes; imported nodes get new ids, so the blocks must too. */
function remapRecipe(
  recipe: PromptRecipe,
  ids: ReadonlyMap<string, string>
): PromptRecipe {
  if (!recipe.blocks) return recipe
  return {
    ...recipe,
    blocks: recipe.blocks.flatMap<PromptBlock>((block) => {
      if (block.kind === "text") return [block]
      const nodeId = ids.get(block.nodeId)
      return nodeId ? [{ ...block, nodeId }] : []
    }),
  }
}
