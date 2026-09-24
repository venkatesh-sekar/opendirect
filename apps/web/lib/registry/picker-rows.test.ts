/**
 * The picker's grouping and filtering, against the registry the app ships.
 *
 * The bundled families are read from `registry/models/` rather than copied
 * here, so "no bundled family takes a character" stays a fact about the
 * files, not about a fixture.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  modelFamilySchema,
  type ModelSummary,
  type ReferenceRole,
  type RegistryFamilyEntry,
} from "@opendirect/contract"

import {
  buildPickerRows,
  type PickerFilter,
  type PickerRow,
} from "./picker-rows"

const BUNDLED = [
  "flux-schnell",
  "nano-banana-2",
  "nano-banana-pro",
  "seedance-2-0",
  "seedance-2-5",
]

const families: RegistryFamilyEntry[] = BUNDLED.map((id) => ({
  family: modelFamilySchema.parse(
    JSON.parse(
      readFileSync(
        resolve(process.cwd(), "registry/models", `${id}.json`),
        "utf8"
      )
    )
  ),
  source: "bundled",
  shadows: [],
  warnings: [],
}))

function summary(
  key: string,
  overrides: Partial<ModelSummary> = {}
): ModelSummary {
  const [provider, slug] = key.split(/:(.*)/s) as [
    ModelSummary["provider"],
    string,
  ]
  return {
    key,
    provider,
    slug,
    name: slug,
    description: null,
    kind: "video",
    coverImageUrl: null,
    priceHint: null,
    ...overrides,
  }
}

const summaries: ModelSummary[] = [
  summary("replicate:bytedance/seedance-2.5", {
    name: "Seedance 2.5",
    priceHint: {
      amount: 0.3,
      unit: "second",
      basis: "per_second",
      source: "provider_api",
    },
  }),
  summary("openrouter:bytedance/seedance-2.5", {
    name: "Seedance 2.5 (OpenRouter)",
    priceHint: {
      amount: 0.2,
      unit: "second",
      basis: "per_second",
      source: "provider_api",
    },
  }),
  summary("replicate:bytedance/seedance-2.0", { name: "Seedance 2.0" }),
  summary("replicate:x/y", { name: "XY" }),
  summary("replicate:acme/sketch", { name: "Sketch", kind: "image" }),
]

function filter(overrides: Partial<PickerFilter> = {}): PickerFilter {
  return {
    kind: "all",
    roles: [],
    includeUnverified: false,
    search: "",
    ...overrides,
  }
}

function build(
  overrides: Partial<PickerFilter> = {},
  capabilities: Record<string, ReferenceRole[]> = {}
) {
  return buildPickerRows({
    families,
    summaries,
    capabilities,
    configured: ["replicate"],
    filter: filter(overrides),
  })
}

const keys = (rows: PickerRow[]) => rows.map((row) => row.key)

describe("buildPickerRows", () => {
  it("collapses a family's endpoints into one row, priced at its cheapest", () => {
    const { families: rows, models } = build()

    const seedance = rows.filter((row) => row.key === "family:seedance-2-5")
    expect(seedance).toHaveLength(1)
    const row = seedance[0]!
    expect(row.type).toBe("family")
    if (row.type !== "family") return
    expect(row.priceHint?.amount).toBe(0.2)
    expect(row.providers).toEqual([
      { id: "replicate", configured: true },
      { id: "openrouter", configured: false },
    ])
    expect(row.roles).toEqual(
      expect.arrayContaining([
        "first_frame",
        "last_frame",
        "reference",
        "soundtrack",
      ])
    )

    // Neither endpoint is listed again on its own.
    expect(keys(models)).not.toContain("replicate:bytedance/seedance-2.5")
    expect(keys(models)).not.toContain("openrouter:bytedance/seedance-2.5")
    expect(keys(models)).not.toContain("replicate:bytedance/seedance-2.0")
    expect(keys(models)).toEqual(["replicate:x/y", "replicate:acme/sketch"])
  })

  it("lists a family even when no summary backs it", () => {
    const { families: rows } = build()
    expect(keys(rows)).toContain("family:flux-schnell")
    const flux = rows.find((row) => row.key === "family:flux-schnell")
    expect(flux?.type === "family" && flux.priceHint).toBeNull()
  })

  it("filters families and models by kind", () => {
    const { families: rows, models } = build({ kind: "image" })
    expect(keys(rows)).not.toContain("family:seedance-2-5")
    expect(keys(rows)).toContain("family:nano-banana-2")
    expect(keys(models)).toEqual(["replicate:acme/sketch"])
  })

  it("Character hides every bundled family and every unmapped model", () => {
    const result = build({ roles: ["character"] })
    expect(result.families).toEqual([])
    expect(result.models).toEqual([])
    // Both unmapped models would show (as not inspected) with the switch on.
    expect(result.hiddenUnverified).toBe(2)
  })

  it("shows an unmapped model whose cached capabilities match, as unverified", () => {
    const result = build(
      { roles: ["character"], includeUnverified: true },
      { "replicate:x/y": ["character"], "replicate:acme/sketch": [] }
    )
    expect(result.families).toEqual([])
    expect(result.models).toEqual([
      {
        type: "model",
        key: "replicate:x/y",
        summary: summaries[3],
        roles: ["character"],
        verified: false,
      },
    ])
    expect(result.hiddenUnverified).toBe(0)
  })

  it("trails models nobody has inspected yet, with null roles", () => {
    const result = build(
      { roles: ["character"], includeUnverified: true },
      { "replicate:x/y": ["character"] }
    )
    expect(result.models.map((row) => [row.key, row.roles])).toEqual([
      ["replicate:x/y", ["character"]],
      ["replicate:acme/sketch", null],
    ])
  })

  it("ANDs the selected roles", () => {
    const result = build(
      { roles: ["character", "style"], includeUnverified: true },
      {
        "replicate:x/y": ["character"],
        "replicate:acme/sketch": ["character", "style"],
      }
    )
    expect(keys(result.models)).toEqual(["replicate:acme/sketch"])
  })

  it("First frame lists both Seedance families", () => {
    const { families: rows } = build({ roles: ["first_frame"] })
    expect(keys(rows).sort()).toEqual([
      "family:seedance-2-0",
      "family:seedance-2-5",
    ])
  })

  it("keeps unmapped models when no role filter is active", () => {
    const result = build({}, { "replicate:x/y": ["character"] })
    expect(result.hiddenUnverified).toBe(0)
    const xy = result.models.find((row) => row.key === "replicate:x/y")
    expect(xy?.roles).toEqual(["character"])
    const sketch = result.models.find(
      (row) => row.key === "replicate:acme/sketch"
    )
    expect(sketch?.roles).toBeNull()
  })

  it("finds a family by an endpoint slug", () => {
    const { families: rows, models } = build({ search: "gemini-3-pro-image" })
    expect(keys(rows)).toEqual(["family:nano-banana-pro"])
    expect(models).toEqual([])
  })

  it("finds families by id, name and role label", () => {
    expect(keys(build({ search: "seedance-2-0" }).families)).toEqual([
      "family:seedance-2-0",
    ])
    expect(keys(build({ search: "banana pro" }).families)).toEqual([
      "family:nano-banana-pro",
    ])
    expect(keys(build({ search: "last frame" }).families).sort()).toEqual([
      "family:seedance-2-0",
      "family:seedance-2-5",
    ])
  })

  it("searches unmapped models by name and key", () => {
    expect(keys(build({ search: "sketch" }).models)).toEqual([
      "replicate:acme/sketch",
    ])
    expect(keys(build({ search: "x/y" }).models)).toEqual(["replicate:x/y"])
  })
})
