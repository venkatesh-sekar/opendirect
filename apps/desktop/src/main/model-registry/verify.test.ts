/**
 * The pure half of `verify:providers --registry`. The schema fetcher is a
 * fake built from the recorded fixtures, so nothing here reaches a provider.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  modelFamilySchema,
  type ModelFamily,
  type ProviderId,
} from "@opendirect/contract"

import { fixtureInputSchema } from "./fixture-schemas"
import {
  formatVerifyReport,
  parseVerifyArgs,
  verifyRegistry,
  type FetchSchema,
} from "./verify"

function bundled(id: string): ModelFamily {
  const text = readFileSync(
    resolve(process.cwd(), "registry/models", `${id}.json`),
    "utf8"
  )
  return modelFamilySchema.parse(JSON.parse(text))
}

type JsonObject = Record<string, unknown>

/** The recorded schema with `reference_images` renamed upstream. */
function renamed(schema: JsonObject): JsonObject {
  const properties = { ...(schema.properties as JsonObject) }
  properties.reference_image_urls = properties.reference_images
  delete properties.reference_images
  return { ...schema, properties }
}

describe("verifyRegistry", () => {
  it("flags exactly the renamed field and reports skipped providers as skipped", async () => {
    const calls: string[] = []
    const fetchSchema: FetchSchema = async (provider, model) => {
      calls.push(`${provider}:${model}`)
      if (provider === "openrouter") {
        return { status: "skipped", reason: "no OPENROUTER_API_KEY" }
      }
      const schema = fixtureInputSchema(provider, model)
      if (!schema) throw new Error(`no fixture for ${model}`)
      return { status: "ok", inputSchema: renamed(schema) }
    }

    const report = await verifyRegistry([bundled("seedance-2-5")], fetchSchema)

    expect(calls).toEqual([
      "replicate:bytedance/seedance-2.5",
      "openrouter:bytedance/seedance-2.5",
    ])
    expect(report.failed).toBe(true)
    expect(report.rows).toHaveLength(2)

    const [replicate, openrouter] = report.rows
    expect(replicate).toMatchObject({
      familyId: "seedance-2-5",
      endpoint: "replicate:bytedance/seedance-2.5",
      status: "issues",
    })
    expect(replicate!.issues).toEqual([
      {
        path: "inputs.reference",
        message:
          'Field "reference_images" is not an input of replicate:bytedance/seedance-2.5.',
      },
    ])
    expect(openrouter).toMatchObject({
      familyId: "seedance-2-5",
      endpoint: "openrouter:bytedance/seedance-2.5",
      status: "skipped",
      issues: [],
      note: "no OPENROUTER_API_KEY",
    })
  })

  it("passes when every live schema still has the mapped fields", async () => {
    const fetchSchema: FetchSchema = async (provider: ProviderId, model) => ({
      status: "ok",
      inputSchema: fixtureInputSchema(provider, model),
    })
    const report = await verifyRegistry(
      [bundled("seedance-2-5"), bundled("flux-schnell")],
      fetchSchema
    )
    expect(report.rows.map((row) => row.status)).toEqual(["ok", "ok", "ok"])
    expect(report.failed).toBe(false)
  })

  it("does not fail on skips alone", async () => {
    const report = await verifyRegistry(
      [bundled("flux-schnell")],
      async () => ({
        status: "skipped",
        reason: "no REPLICATE_API_TOKEN",
      })
    )
    expect(report.rows.map((row) => row.status)).toEqual(["skipped"])
    expect(report.failed).toBe(false)
  })

  it("reports a failed fetch as an error and keeps going", async () => {
    let n = 0
    const report = await verifyRegistry(
      [bundled("flux-schnell"), bundled("nano-banana-2")],
      async (provider, model) => {
        n += 1
        if (n === 1) throw new Error("404 Not Found")
        return {
          status: "ok",
          inputSchema: fixtureInputSchema(provider, model),
        }
      }
    )
    expect(report.rows[0]).toMatchObject({
      status: "error",
      note: "404 Not Found",
    })
    expect(report.rows.slice(1).every((row) => row.status === "ok")).toBe(true)
    expect(report.failed).toBe(true)
  })
})

describe("formatVerifyReport", () => {
  it("prints one line per endpoint, with each issue under its row", () => {
    const text = formatVerifyReport({
      failed: true,
      rows: [
        {
          familyId: "seedance-2-5",
          endpoint: "replicate:bytedance/seedance-2.5",
          status: "issues",
          issues: [{ path: "inputs.reference", message: "Gone." }],
          note: null,
        },
        {
          familyId: "seedance-2-5",
          endpoint: "openrouter:bytedance/seedance-2.5",
          status: "skipped",
          issues: [],
          note: "no OPENROUTER_API_KEY",
        },
        {
          familyId: "flux-schnell",
          endpoint: "replicate:black-forest-labs/flux-schnell",
          status: "ok",
          issues: [],
          note: null,
        },
      ],
    })
    const lines = text.split("\n")
    expect(lines[0]).toMatch(
      /^seedance-2-5 · replicate:bytedance\/seedance-2\.5\s+1 issue$/
    )
    expect(lines[1]).toBe("    inputs.reference: Gone.")
    expect(lines[2]).toMatch(/skipped \(no OPENROUTER_API_KEY\)$/)
    expect(lines[3]).toMatch(/^flux-schnell · .+\s+OK$/)
  })
})

describe("parseVerifyArgs", () => {
  it("reads --registry and --file, tolerating pnpm's -- separator", () => {
    expect(parseVerifyArgs([])).toEqual({ registry: false, files: [] })
    expect(
      parseVerifyArgs(["--", "--registry", "--file", "a.json", "--file=b.json"])
    ).toEqual({ registry: true, files: ["a.json", "b.json"] })
  })

  it("rejects an unknown flag or a --file with no path", () => {
    expect(() => parseVerifyArgs(["--registy"])).toThrow(/--registy/)
    expect(() => parseVerifyArgs(["--registry", "--file"])).toThrow(/--file/)
  })

  it("treats --file as registry mode", () => {
    expect(parseVerifyArgs(["--file", "x.json"])).toEqual({
      registry: true,
      files: ["x.json"],
    })
  })
})
