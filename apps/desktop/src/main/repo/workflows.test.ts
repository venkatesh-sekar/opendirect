import { beforeEach, afterEach, expect, it } from "vitest"
import { workflowSchema } from "@opendirect/contract"
import { createDatabase, type DatabaseHandle } from "../db/client"
import { runMigrations, resolveMigrationsFolder } from "../db/migrate"
import { projects } from "../db/schema"
import { importWorkflow } from "./workflows"
import { getCanvas } from "./canvas"

let handle: DatabaseHandle
beforeEach(() => {
  handle = createDatabase(":memory:")
  runMigrations(handle, resolveMigrationsFolder(__dirname))
  handle.db
    .insert(projects)
    .values({ id: "p", name: "Test", path: "/tmp/test", createdAt: 1 })
    .run()
})
afterEach(() => handle.close())
function workflow() {
  return workflowSchema.parse({
    format: "opendirect-workflow",
    version: 1,
    name: "Portrait to video",
    nodes: [
      {
        id: "image",
        type: "image_gen",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        text: null,
        recipe: {
          prompt: "A portrait",
          modelKey: "openrouter:test/image",
          count: 2,
        },
      },
      {
        id: "video",
        type: "video_gen",
        x: 500,
        y: 0,
        width: 400,
        height: 300,
        text: null,
        recipe: { prompt: "Slow pan", modelKey: null },
      },
    ],
    edges: [{ sourceNodeId: "image", targetNodeId: "video", slotField: null }],
  })
}
it("appends remapped graphs with persisted recipes and preserves existing nodes", () => {
  const first = importWorkflow(handle.db, "p", workflow())
  const second = importWorkflow(handle.db, "p", workflow())
  expect(first.nodes).toHaveLength(2)
  expect(second.nodes).toHaveLength(4)
  expect(new Set(second.nodes.map((node) => node.id)).size).toBe(4)
  expect(second.edges).toHaveLength(2)
  expect(first.nodes.map((node) => node.id)).not.toContain("image")
  expect(
    second.nodes.filter(
      (node) => JSON.parse(node.text!).prompt === "A portrait"
    )
  ).toHaveLength(2)
  for (const node of second.nodes) expect(node.generationId).toBeNull()
})
it("rolls the entire import back when a connection cannot be created", () => {
  const invalid = workflow()
  invalid.edges[0]!.targetNodeId = "missing"
  expect(() => importWorkflow(handle.db, "p", invalid)).toThrow()
  expect(getCanvas(handle.db, "p").nodes).toHaveLength(0)
})
