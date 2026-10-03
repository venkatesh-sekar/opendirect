/**
 * The recommended table is a hand-maintained list of slugs. These tests do not
 * hit the network: they check the table against the catalogs recorded on
 * 2026-09-16, so a drifting slug shows up here rather than as an empty picker.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  modelFamilySchema,
  modelKey,
  parseModelKey,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { BUNDLED_FAMILIES } from "../model-registry/bundled"

import {
  RECOMMENDED,
  describeRecommended,
  recommendedFor,
  recommendedKeys,
} from "./defaults"

function fixtureIds(provider: string, name: string): string[] {
  const path = resolve(process.cwd(), "test/fixtures", provider, `${name}.json`)
  const body = JSON.parse(readFileSync(path, "utf8")) as {
    data?: Array<{ id: string }>
    models?: Array<{ owner: string; name: string }>
  }
  return (
    body.data?.map((model) => model.id) ??
    body.models?.map((model) => `${model.owner}/${model.name}`) ??
    []
  )
}

describe("RECOMMENDED", () => {
  it("uses well-formed catalog keys", () => {
    for (const key of recommendedKeys()) {
      expect(parseModelKey(key)).not.toBeNull()
    }
  })

  it("has no duplicates", () => {
    const keys = recommendedKeys()
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("recommends only models OpenRouter still lists", () => {
    const listed = fixtureIds("openrouter", "videos-models")
    const openrouterVideo = RECOMMENDED.video
      .map((model) => parseModelKey(model.key)!)
      .filter((parsed) => parsed.provider === "openrouter")

    expect(openrouterVideo.length).toBeGreaterThan(0)
    for (const parsed of openrouterVideo) {
      expect(listed).toContain(parsed.slug)
    }
  })

  it("keeps the Seedance and Nano Banana defaults first", () => {
    expect(RECOMMENDED.video[0].key).toBe("replicate:bytedance/seedance-2.5")
    expect(RECOMMENDED.image[0].key).toBe("replicate:google/nano-banana-2")
  })

  it("recommends only Replicate models a bundled family maps", () => {
    const mapped = new Set(
      BUNDLED_FAMILIES.flatMap(({ raw }) =>
        modelFamilySchema
          .parse(raw)
          .endpoints.map((endpoint) =>
            modelKey(endpoint.provider, endpoint.model)
          )
      )
    )
    const replicate = recommendedKeys().filter((key) =>
      key.startsWith("replicate:")
    )
    expect(replicate.filter((key) => !mapped.has(key))).toEqual([])
  })

  it("offers several video and image models, not just the defaults", () => {
    expect(RECOMMENDED.video.length).toBeGreaterThanOrEqual(5)
    expect(RECOMMENDED.image.length).toBeGreaterThanOrEqual(5)
  })

  it("marks a recommendation the catalog no longer lists as unavailable", () => {
    const described = describeRecommended([
      "replicate:bytedance/seedance-2.5",
      "replicate:google/nano-banana-2",
    ])

    expect(described.video).toContainEqual({
      key: "replicate:bytedance/seedance-2.5",
      label: "Seedance 2.5 (Replicate)",
      kind: "video",
      available: true,
    })
    expect(
      described.video.find((m) => m.key === "openrouter:bytedance/seedance-2.5")
        ?.available
    ).toBe(false)
    expect(described.image.map((m) => m.available)).toEqual(
      RECOMMENDED.image.map((m) => m.key === "replicate:google/nano-banana-2")
    )
    expect(described.video).toHaveLength(RECOMMENDED.video.length)
  })

  it("exposes the list per modality and nothing for the others", () => {
    expect(recommendedFor("video")).toBe(RECOMMENDED.video)
    expect(recommendedFor("image")).toBe(RECOMMENDED.image)
    expect(recommendedFor("audio")).toEqual([])
  })
})
