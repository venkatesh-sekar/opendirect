/**
 * Guards against registry drift (design §6). Every bundled mapping must parse,
 * name only shapes the app ships, map only fields the provider really
 * publishes (checked against the recorded fixtures, never the network), be
 * listed in the index and imported by `bundled.ts`, and be stored in the
 * canonical format so a diff only ever shows a real change.
 */
import { readdirSync, readFileSync } from "node:fs"
import { basename, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  REGISTRY_FORMAT,
  SHAPES,
  checkEndpointAgainstSchema,
  formatFamilyJson,
  modelFamilySchema,
  registryIndexSchema,
  type ModelFamily,
} from "@opendirect/contract"

import { BUNDLED_FAMILIES, BUNDLED_INDEX } from "./bundled"
import { fixtureInputSchema } from "./fixture-schemas"

const REGISTRY = resolve(process.cwd(), "registry")
const MODELS = resolve(REGISTRY, "models")

const files = readdirSync(MODELS)
  .filter((file) => file.endsWith(".json"))
  .sort()

function readFamily(file: string): { text: string; family: ModelFamily } {
  const text = readFileSync(resolve(MODELS, file), "utf8")
  return { text, family: modelFamilySchema.parse(JSON.parse(text)) }
}

describe("fixtureInputSchema", () => {
  it("reads recorded schemas and knows when none is recorded", () => {
    const replicate = fixtureInputSchema("replicate", "bytedance/seedance-2.5")
    expect(Object.keys(replicate?.properties ?? {})).toContain(
      "reference_images"
    )
    const openrouter = fixtureInputSchema(
      "openrouter",
      "bytedance/seedance-2.5"
    )
    expect(Object.keys(openrouter?.properties ?? {})).toContain("first_frame")
    expect(fixtureInputSchema("replicate", "nobody/nothing")).toBeNull()
    expect(fixtureInputSchema("openrouter", "nobody/nothing")).toBeNull()
  })
})

describe("bundled registry", () => {
  it("has at least one family file", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)("%s parses and its id matches the file name", (file) => {
    const raw = JSON.parse(
      readFileSync(resolve(MODELS, file), "utf8")
    ) as unknown
    const result = modelFamilySchema.safeParse(raw)
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.data?.id).toBe(basename(file, ".json"))
  })

  it.each(files)("%s names only shapes the app ships", (file) => {
    const { family } = readFamily(file)
    for (const endpoint of family.endpoints) {
      for (const [key, input] of Object.entries(endpoint.inputs)) {
        if (input.shape === undefined) continue
        expect(
          Object.hasOwn(SHAPES, input.shape),
          `${file} ${endpoint.provider}:${endpoint.model} inputs.${key} names unknown shape "${input.shape}"`
        ).toBe(true)
      }
    }
  })

  it.each(files)("%s maps only fields the recorded schema has", (file) => {
    const { family } = readFamily(file)
    for (const endpoint of family.endpoints) {
      const where = `${endpoint.provider}:${endpoint.model}`
      const schema = fixtureInputSchema(endpoint.provider, endpoint.model)
      expect(
        schema,
        `record a fixture for ${where} before mapping it`
      ).not.toBeNull()
      const issues = checkEndpointAgainstSchema(endpoint, schema).map(
        (issue) => `${file} ${where} ${issue.path}: ${issue.message}`
      )
      expect(issues).toEqual([])
    }
  })

  it.each(files)("%s bounds no input above the schema's maxItems", (file) => {
    const { family } = readFamily(file)
    const over: string[] = []
    for (const endpoint of family.endpoints) {
      const schema = fixtureInputSchema(endpoint.provider, endpoint.model)
      const properties = (schema?.properties ?? {}) as Record<
        string,
        { maxItems?: unknown } | undefined
      >
      for (const [key, input] of Object.entries(endpoint.inputs)) {
        if (input.max === undefined) continue
        const property = properties[input.field]
        const maxItems = property?.maxItems
        if (typeof maxItems === "number" && input.max > maxItems) {
          over.push(
            `${endpoint.provider}:${endpoint.model} inputs.${key}.max is ${input.max}, but "${input.field}" takes at most ${maxItems}`
          )
        }
      }
    }
    expect(over).toEqual([])
  })

  it("index, files on disk and bundled.ts list the same families", () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(resolve(REGISTRY, "index.json"), "utf8"))
    )
    expect(index.format).toBe(REGISTRY_FORMAT)
    expect(registryIndexSchema.parse(BUNDLED_INDEX)).toEqual(index)

    const onDisk = files.map((file) => basename(file, ".json")).sort()
    expect([...index.families].sort()).toEqual(onDisk)
    expect(
      BUNDLED_FAMILIES.map((entry) => basename(entry.origin, ".json")).sort()
    ).toEqual(onDisk)

    for (const entry of BUNDLED_FAMILIES) {
      const file = basename(entry.origin)
      expect(entry.origin).toBe(`registry/models/${file}`)
      expect(entry.raw).toEqual(
        JSON.parse(readFileSync(resolve(MODELS, file), "utf8"))
      )
    }
  })

  it.each(files)("%s is stored in the canonical format", (file) => {
    const { text, family } = readFamily(file)
    expect(text).toBe(formatFamilyJson(family))
  })

  it("maps each provider model in at most one family", () => {
    const owner = new Map<string, string>()
    const duplicates: string[] = []
    for (const file of files) {
      const { family } = readFamily(file)
      for (const endpoint of family.endpoints) {
        const key = `${endpoint.provider}:${endpoint.model}`
        const other = owner.get(key)
        if (other !== undefined) {
          duplicates.push(`${key} is in both ${other} and ${family.id}`)
        }
        owner.set(key, family.id)
      }
    }
    expect(duplicates).toEqual([])
  })
})
