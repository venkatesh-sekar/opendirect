import { describe, expect, it } from "vitest"

import type { CanvasNodeDto } from "@opendirect/contract"

import { resolveCanvasFocus } from "./focus-request"

function node(
  id: string,
  over: Partial<Pick<CanvasNodeDto, "containerId" | "generation">> = {}
): Pick<CanvasNodeDto, "id" | "containerId" | "generation"> {
  return { id, containerId: null, generation: null, ...over }
}

describe("resolveCanvasFocus", () => {
  it("centres a node when the request names one", () => {
    expect(resolveCanvasFocus([node("n1"), node("n2")], "n2")).toEqual({
      kind: "node",
      ids: ["n2"],
    })
  })

  /**
   * `/canvas/?focus=<containerId>`: the request names a container, and the
   * canvas frames every node filed under it — including a node whose own tag
   * is empty but whose run was filed there.
   */
  it("frames a container's nodes when the request names a container", () => {
    const nodes = [
      node("tagged", { containerId: "mira" }),
      node("elsewhere", { containerId: "ruiz" }),
      node("ran-there", {
        generation: { containerId: "mira" } as CanvasNodeDto["generation"],
      }),
    ]
    expect(resolveCanvasFocus(nodes, "mira")).toEqual({
      kind: "container",
      ids: ["tagged", "ran-there"],
    })
  })

  it("finds nothing to frame for a container with no nodes", () => {
    expect(resolveCanvasFocus([node("n1")], "mira")).toBeNull()
  })
})
