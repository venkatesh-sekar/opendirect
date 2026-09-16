/**
 * The recommended table is a hand-maintained list of slugs. These tests do not
 * hit the network: they check the table against the catalogs recorded on
 * 2026-09-16, so a drifting slug shows up here rather than as an empty picker.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { parseModelKey } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { RECOMMENDED, recommendedFor, recommendedKeys } from "./defaults"

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

  it("exposes the list per modality and nothing for the others", () => {
    expect(recommendedFor("video")).toBe(RECOMMENDED.video)
    expect(recommendedFor("image")).toBe(RECOMMENDED.image)
    expect(recommendedFor("audio")).toEqual([])
  })
})
