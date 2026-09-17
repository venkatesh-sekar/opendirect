import { describe, expect, it } from "vitest"
import { workflowSchema } from "./workflow"

const workflow = {
  format: "opendirect-workflow",
  version: 1,
  name: "A scene",
  nodes: [
    {
      id: "a",
      type: "image_gen",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      text: null,
      recipe: { prompt: "A forest", modelKey: "openrouter:test/image" },
    },
  ],
  edges: [],
}
describe("portable workflows", () => {
  it("round trips prompts while stripping unknown top-level fields", () => {
    const parsed = workflowSchema.parse({ ...workflow, apiKey: "private" })
    expect(parsed).not.toHaveProperty("apiKey")
    expect(workflowSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      parsed
    )
  })
  it("rejects unsupported versions, duplicate IDs and dangling connections", () => {
    expect(workflowSchema.safeParse({ ...workflow, version: 2 }).success).toBe(
      false
    )
    expect(
      workflowSchema.safeParse({
        ...workflow,
        nodes: [workflow.nodes[0], workflow.nodes[0]],
      }).success
    ).toBe(false)
    expect(
      workflowSchema.safeParse({
        ...workflow,
        edges: [
          { sourceNodeId: "missing", targetNodeId: "a", slotField: null },
        ],
      }).success
    ).toBe(false)
  })
  it("rejects excessive batch counts and invalid model keys", () => {
    for (const recipe of [
      { prompt: "Hello", modelKey: "invalid" },
      { prompt: "Hello", modelKey: null, count: 100 },
    ]) {
      expect(
        workflowSchema.safeParse({
          ...workflow,
          nodes: [{ ...workflow.nodes[0], recipe }],
        }).success
      ).toBe(false)
    }
  })
})
