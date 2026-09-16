/**
 * The seam the prompt bar runs: edges → occupancy → substitution.
 *
 * `edgesToInputs` says what the user wired, `countBySlot` turns that into the
 * tally a mention has to fit around, and `resolveMentions` fills what is left.
 * The rule these tests pin down is that **the edges always win**: a wire is an
 * explicit gesture and a mention is an inference, so a mention never displaces
 * one and never renumbers one.
 *
 * ⛔ Literal rows and a literal schema. No provider, no IPC, no cost.
 */
import type {
  CanvasEdgeDto,
  CanvasNodeDto,
  MentionSubjectDto,
  ReferenceSlot,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { deriveReferenceSlots } from "../../../desktop/src/main/providers/reference-slots"
import {
  composePrompt,
  edgesToInputs,
  isBlocked,
} from "../canvas/edges-to-inputs"
import { countBySlot, resolveMentions } from "./resolve"

const MULTI_IMAGE: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    reference_images: {
      type: "array",
      items: { type: "string", format: "uri" },
      maxItems: 4,
      title: "Reference Images",
    },
  },
})

const SINGLE_IMAGE: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    image: { type: "string", format: "uri" },
  },
})

const VENKZ: MentionSubjectDto = {
  containerId: "c-venkz",
  kind: "character",
  handle: "venkz",
  name: "Venkz",
  description: "a tired bellhop",
  images: [
    { assetId: "a-venkz", label: "Character Sheet", thumbnailUrl: null },
  ],
}

function node(over: Partial<CanvasNodeDto> & { id: string }): CanvasNodeDto {
  return {
    projectId: "p1",
    type: "media",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    assetId: null,
    pickAssetId: null,
    text: null,
    asset: null,
    createdAt: 1,
    ...over,
  } as CanvasNodeDto
}

function edge(over: Partial<CanvasEdgeDto> & { id: string }): CanvasEdgeDto {
  return {
    projectId: "p1",
    sourceNodeId: "",
    targetNodeId: "target",
    slotField: null,
    createdAt: 1,
    ...over,
  } as CanvasEdgeDto
}

const TARGET = node({ id: "target", type: "video_gen" })

describe("edges and mentions together", () => {
  it("gives the wired reference position 0 and numbers the mention after it", () => {
    const inputs = edgesToInputs({
      targetNodeId: "target",
      nodes: [
        TARGET,
        node({ id: "note", type: "text", text: "a bellhop opens the lift" }),
        node({ id: "still", assetId: "a0" }),
      ],
      edges: [
        edge({ id: "e-text", sourceNodeId: "note", createdAt: 1 }),
        edge({
          id: "e-media",
          sourceNodeId: "still",
          slotField: "reference_images",
          createdAt: 2,
        }),
      ],
      slots: MULTI_IMAGE,
    })
    expect(isBlocked(inputs)).toBe(false)
    if (isBlocked(inputs)) return

    const resolved = resolveMentions({
      prompt: composePrompt(inputs.promptPrefix, "a shot of @venkz"),
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: countBySlot(inputs.references),
    })

    expect(resolved.references).toEqual([
      { slotField: "reference_images", assetId: "a-venkz", position: 1 },
    ])
    // The number is the position in the payload the provider receives, which
    // is the edge's image first.
    expect(resolved.prompt).toBe(
      "a bellhop opens the lift\n\na shot of Venkz (the person in reference image 2)"
    )
    expect(
      [...inputs.references, ...resolved.references].map((one) => one.assetId)
    ).toEqual(["a0", "a-venkz"])
  })

  it("downgrades rather than displacing the one image the user wired", () => {
    const inputs = edgesToInputs({
      targetNodeId: "target",
      nodes: [TARGET, node({ id: "still", assetId: "a0" })],
      edges: [
        edge({ id: "e-media", sourceNodeId: "still", slotField: "image" }),
      ],
      slots: SINGLE_IMAGE,
    })
    if (isBlocked(inputs)) throw new Error(inputs.blocked)

    const resolved = resolveMentions({
      prompt: "@venkz waits",
      subjects: [VENKZ],
      slots: SINGLE_IMAGE,
      occupied: countBySlot(inputs.references),
    })

    expect(resolved.references).toEqual([])
    expect(resolved.outcomes).toEqual([
      {
        kind: "text",
        handle: "venkz",
        containerId: "c-venkz",
        reason: "slots-full",
        substitution: "a tired bellhop",
      },
    ])
    expect(resolved.prompt).toBe("a tired bellhop waits")
  })

  it("fills the empty slot when the only edge is a note", () => {
    const inputs = edgesToInputs({
      targetNodeId: "target",
      nodes: [TARGET, node({ id: "note", type: "text", text: "at dawn" })],
      edges: [edge({ id: "e-text", sourceNodeId: "note" })],
      slots: SINGLE_IMAGE,
    })
    if (isBlocked(inputs)) throw new Error(inputs.blocked)

    const resolved = resolveMentions({
      prompt: composePrompt(inputs.promptPrefix, "@venkz waits"),
      subjects: [VENKZ],
      slots: SINGLE_IMAGE,
      occupied: countBySlot(inputs.references),
    })

    expect(resolved.references).toEqual([
      { slotField: "image", assetId: "a-venkz", position: 0 },
    ])
    expect(resolved.prompt).toBe(
      "at dawn\n\nVenkz (the person in the reference image) waits"
    )
  })
})
