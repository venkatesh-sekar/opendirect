import type { Workflow } from "@opendirect/contract"
import type { ProjectDatabase } from "../db/client"
import { createNode, createEdge, getCanvas } from "./canvas"

/** Append a portable graph in one transaction, remapping every node ID. */
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
    const ids = new Map<string, string>()
    for (const node of workflow.nodes) {
      const made = createNode(db, {
        projectId: projectId,
        type: node.type,
        x: node.x - left + offset,
        y: node.y,
        width: node.width,
        height: node.height,
        text: node.recipe ? JSON.stringify(node.recipe) : node.text,
        modelKey: node.recipe?.modelKey ?? null,
      })
      ids.set(node.id, made.id)
    }
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
