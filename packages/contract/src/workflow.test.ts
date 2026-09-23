import { describe, expect, it } from "vitest"
import { promptRecipeSchema, workflowSchema } from "./workflow"

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
  it("accepts a family model key and still rejects a malformed one", () => {
    const parse = (modelKey: string) =>
      promptRecipeSchema.safeParse({ prompt: "", modelKey }).success
    expect(parse("family:seedance-2-5")).toBe(true)
    expect(parse("nope")).toBe(false)
  })
  it("parses a recipe without blocks and round trips one with blocks", () => {
    expect(workflowSchema.safeParse(workflow).success).toBe(true)
    const withBlocks = {
      ...workflow,
      nodes: [
        {
          ...workflow.nodes[0],
          recipe: {
            prompt: "A forest",
            modelKey: "openrouter:test/image",
            blocks: [
              { kind: "note", nodeId: "n1" },
              { kind: "text", text: "A forest" },
            ],
          },
        },
      ],
    }
    const parsed = workflowSchema.parse(withBlocks)
    expect(parsed.nodes[0]!.recipe!.blocks).toEqual(
      withBlocks.nodes[0]!.recipe.blocks
    )
    expect(workflowSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      parsed
    )
  })
  it("strips UI ids from blocks and rejects unknown block kinds", () => {
    const recipe = promptRecipeSchema.parse({
      prompt: "",
      modelKey: null,
      blocks: [{ id: "t-1", kind: "text", text: "x" }],
    })
    expect(recipe.blocks).toEqual([{ kind: "text", text: "x" }])
    expect(
      promptRecipeSchema.safeParse({
        prompt: "",
        modelKey: null,
        blocks: [{ kind: "image" }],
      }).success
    ).toBe(false)
  })
})
