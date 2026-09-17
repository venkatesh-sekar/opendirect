import { z } from "zod"
import { canvasNodeTypeSchema } from "./canvas"
import { parseModelKey } from "./model"

export const promptRecipeSchema = z.object({
  prompt: z.string().max(100_000),
  modelKey: z
    .string()
    .refine((key) => parseModelKey(key) !== null, "Invalid model key")
    .nullable(),
  common: z.record(z.string(), z.unknown()).default({}),
  advanced: z.record(z.string(), z.unknown()).default({}),
  count: z.number().int().min(1).max(16).default(1),
})
export type PromptRecipe = z.output<typeof promptRecipeSchema>

export const workflowSchema = z
  .object({
    format: z.literal("opendirect-workflow"),
    version: z.literal(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    nodes: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          type: canvasNodeTypeSchema,
          x: z.number().min(-100000).max(100000),
          y: z.number().min(-100000).max(100000),
          width: z.number().positive().max(10000),
          height: z.number().positive().max(10000),
          text: z.string().max(100000).nullable(),
          recipe: promptRecipeSchema.nullable(),
        })
      )
      .min(1)
      .max(200),
    edges: z
      .array(
        z.object({
          sourceNodeId: z.string(),
          targetNodeId: z.string(),
          slotField: z.string().max(200).nullable(),
        })
      )
      .max(1000),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.nodes.map((node) => node.id))
    if (ids.size !== value.nodes.length)
      ctx.addIssue({ code: "custom", message: "Duplicate node IDs" })
    const links = new Set<string>()
    for (const edge of value.edges) {
      const target = value.nodes.find((node) => node.id === edge.targetNodeId)
      const key = JSON.stringify(edge)
      if (
        !ids.has(edge.sourceNodeId) ||
        !target ||
        edge.sourceNodeId === edge.targetNodeId ||
        !["image_gen", "video_gen"].includes(target.type) ||
        links.has(key)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid or duplicate workflow connection",
        })
      }
      links.add(key)
    }
  })
export type Workflow = z.output<typeof workflowSchema>
