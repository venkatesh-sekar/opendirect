// @vitest-environment jsdom
import type { GenerationDto, Lineage } from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { LineageView } from "./lineage-view"

function gen(
  id: string,
  parentGenerationId: string | null = null,
  overrides: Partial<GenerationDto> = {}
): GenerationDto {
  return {
    id,
    projectId: "p1",
    containerId: "c1",
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: null,
    kind: "video",
    prompt: `prompt for ${id}`,
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "succeeded",
    error: null,
    providerJobId: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: null,
    parentGenerationId,
    batchId: null,
    branchNote: null,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** portrait.jpg + hotel-ref → image-42 → video-53, video-56 */
const lineage: Lineage = {
  generation: gen("image-42", "portrait", { kind: "image" }),
  ancestors: [gen("portrait", null, { kind: "image" })],
  descendants: [gen("video-53", "image-42"), gen("video-56", "image-42")],
}

afterEach(cleanup)

function ids() {
  return screen
    .getAllByTestId("lineage-node")
    .map((node) => node.dataset.generationId)
}

describe("LineageView", () => {
  it("renders every generation in the payload exactly once", () => {
    render(<LineageView lineage={lineage} />)
    expect(ids()).toEqual(["portrait", "image-42", "video-53", "video-56"])
  })

  it("draws an edge from each run to the one it came from", () => {
    render(<LineageView lineage={lineage} />)
    const edges = screen
      .getAllByTestId("lineage-node")
      .map((node) => [node.dataset.generationId, node.dataset.parentId ?? null])

    expect(edges).toEqual([
      ["portrait", null],
      ["image-42", "portrait"],
      ["video-53", "image-42"],
      ["video-56", "image-42"],
    ])
  })

  it("marks the generation the panel is open on, and only that one", () => {
    render(<LineageView lineage={lineage} />)
    const current = screen
      .getAllByTestId("lineage-node")
      .filter((node) => node.getAttribute("aria-current") === "true")

    expect(current).toHaveLength(1)
    expect(current[0]?.dataset.generationId).toBe("image-42")
    expect(screen.getByText("This run")).toBeInTheDocument()
  })

  it("nests a branch one level below the run it branched from", () => {
    render(<LineageView lineage={lineage} />)
    expect(
      screen.getAllByTestId("lineage-node").map((node) => node.dataset.depth)
    ).toEqual(["0", "1", "2", "2"])
  })

  it("says so when a run has no history at all", () => {
    render(
      <LineageView
        lineage={{ generation: gen("only"), ancestors: [], descendants: [] }}
      />
    )
    expect(screen.getAllByTestId("lineage-node")).toHaveLength(1)
    expect(screen.getByText(/only run in its branch/i)).toBeInTheDocument()
  })
})
