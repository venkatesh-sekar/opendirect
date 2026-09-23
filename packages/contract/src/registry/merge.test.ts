import { describe, expect, it } from "vitest"

import { mergeRegistry } from "./merge"

function family(
  id: string,
  name: string,
  model = `acme/${id}`,
  provider = "replicate"
) {
  return {
    id,
    name,
    kind: "video",
    endpoints: [
      {
        provider,
        model,
        inputs: { first_frame: { field: "image", kind: "image" } },
        controls: { prompt: { field: "prompt" } },
      },
    ],
  }
}

describe("mergeRegistry", () => {
  it("returns every valid family, sorted by name", () => {
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [
          { origin: "zeta.json", raw: family("zeta", "Zeta") },
          { origin: "alpha.json", raw: family("alpha", "Alpha") },
        ],
      },
    ])
    expect(merged.families.map((e) => e.family.id)).toEqual(["alpha", "zeta"])
    expect(merged.families[0]).toMatchObject({
      source: "bundled",
      shadows: [],
      warnings: [],
    })
    expect(merged.warnings).toEqual([])
  })

  it("lets a user entry replace a bundled one wholesale, recording the shadow", () => {
    const user = family("seedance-2-5", "Seedance (mine)", "acme/other")
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [{ origin: "b", raw: family("seedance-2-5", "Seedance") }],
      },
      { source: "remote", entries: [] },
      { source: "user", entries: [{ origin: "u", raw: user }] },
    ])
    expect(merged.families).toHaveLength(1)
    const [entry] = merged.families
    expect(entry!.source).toBe("user")
    expect(entry!.shadows).toEqual(["bundled"])
    expect(entry!.family.name).toBe("Seedance (mine)")
    // No deep merge: the bundled endpoint is gone.
    expect(entry!.family.endpoints.map((e) => e.model)).toEqual(["acme/other"])
    expect(merged.endpointIndex.get("replicate:acme/other")).toBe(
      "seedance-2-5"
    )
    expect(merged.endpointIndex.has("replicate:acme/seedance-2-5")).toBe(false)
  })

  it("records every lower layer an entry shadows", () => {
    const merged = mergeRegistry([
      { source: "bundled", entries: [{ origin: "b", raw: family("x", "X") }] },
      { source: "remote", entries: [{ origin: "r", raw: family("x", "X") }] },
      { source: "user", entries: [{ origin: "u", raw: family("x", "X") }] },
    ])
    expect(merged.families[0]!.shadows).toEqual(["bundled", "remote"])
  })

  it("keeps the bundled family when the remote one is invalid, with a warning", () => {
    const broken = { ...family("x", "X"), kind: "hologram" }
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [{ origin: "x.json", raw: family("x", "X") }],
      },
      { source: "remote", entries: [{ origin: "remote x.json", raw: broken }] },
    ])
    expect(merged.families[0]!.source).toBe("bundled")
    expect(merged.warnings).toHaveLength(1)
    expect(merged.warnings[0]).toMatchObject({
      source: "remote",
      familyId: "x",
    })
    expect(merged.warnings[0]!.message).toMatch(/^remote x\.json: kind: /)
    // The family in force carries the warning too, so its row can show it.
    expect(merged.families[0]!.warnings).toEqual([merged.warnings[0]!.message])
  })

  it("warns with a null family id when the raw entry has no id", () => {
    const merged = mergeRegistry([
      { source: "user", entries: [{ origin: "draft", raw: { name: 3 } }] },
    ])
    expect(merged.families).toEqual([])
    expect(merged.warnings[0]).toMatchObject({ source: "user", familyId: null })
    expect(merged.warnings[0]!.message).toMatch(/^draft: /)
  })

  it("keeps the first of two entries with the same id in one layer", () => {
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [
          { origin: "a.json", raw: family("x", "First") },
          { origin: "b.json", raw: family("x", "Second") },
        ],
      },
    ])
    expect(merged.families.map((e) => e.family.name)).toEqual(["First"])
    expect(merged.warnings).toHaveLength(1)
    expect(merged.warnings[0]!.message).toMatch(/^b\.json: .*"x".*a\.json/)
  })

  it("warns when two families map the same endpoint, indexing the higher layer", () => {
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [{ origin: "a", raw: family("a", "A", "acme/shared") }],
      },
      {
        source: "user",
        entries: [{ origin: "b", raw: family("b", "B", "acme/shared") }],
      },
    ])
    expect(merged.endpointIndex.get("replicate:acme/shared")).toBe("b")
    expect(merged.warnings).toHaveLength(1)
    expect(merged.warnings[0]!.message).toContain("replicate:acme/shared")
    expect(merged.warnings[0]!.message).toContain('"a"')
    expect(merged.warnings[0]!.message).toContain('"b"')
  })

  it("breaks a same-layer endpoint tie alphabetically", () => {
    const merged = mergeRegistry([
      {
        source: "bundled",
        entries: [
          { origin: "z", raw: family("zed", "Zed", "acme/shared") },
          { origin: "a", raw: family("ay", "Ay", "acme/shared") },
        ],
      },
    ])
    expect(merged.endpointIndex.get("replicate:acme/shared")).toBe("ay")
    expect(merged.warnings).toHaveLength(1)
  })
})
