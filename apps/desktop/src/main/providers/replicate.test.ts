/**
 * ⛔ Every request in this file is served by `msw` from recorded fixtures.
 * The fixtures under `test/fixtures/replicate/` were captured once with
 * read-only `GET` calls (models + collections). Nothing here — least of all
 * `submit` — is ever allowed to reach the live API; the root harness runs msw
 * with `onUnhandledRequest: "error"` so an escape fails the suite.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"

import { server } from "../../../../../test/msw/server"
import { dereferenceCogSchema, createReplicateProvider } from "./replicate"
import type { ModelProvider } from "./types"

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/replicate", `${name}.json`),
      "utf8"
    )
  ) as Record<string, unknown>
}

/** The `Input` properties exactly as Replicate recorded them, for round-trips. */
function recordedInputProperties(name: string): Record<string, unknown> {
  const model = fixture(name) as {
    latest_version: {
      openapi_schema: {
        components: {
          schemas: { Input: { properties: Record<string, unknown> } }
        }
      }
    }
  }
  return model.latest_version.openapi_schema.components.schemas.Input.properties
}

const MODELS: Record<string, string> = {
  "bytedance/seedance-2.5": "model-seedance-2.5",
  "bytedance/seedance-2.0": "model-seedance-2.0",
  "google/nano-banana-2": "model-nano-banana-2",
  "google/nano-banana-pro": "model-nano-banana-pro",
}

const COLLECTIONS: Record<string, string> = {
  "text-to-video": "collection-text-to-video",
  "text-to-image": "collection-text-to-image",
  official: "collection-official",
}

/** Serves only the recorded fixtures; anything else 404s, as Replicate would. */
function useReadOnlyApi(): void {
  server.use(
    http.get(
      "https://api.replicate.com/v1/models/:owner/:name",
      ({ params }) => {
        const slug = `${params.owner}/${params.name}`
        const name = MODELS[slug]
        return name
          ? HttpResponse.json(fixture(name))
          : HttpResponse.json({ detail: "Not found." }, { status: 404 })
      }
    ),
    http.get("https://api.replicate.com/v1/collections/:slug", ({ params }) => {
      const name = COLLECTIONS[String(params.slug)]
      return name
        ? HttpResponse.json(fixture(name))
        : HttpResponse.json({ detail: "Not found." }, { status: 404 })
    })
  )
}

const NOW = 1_758_000_000_000

function makeProvider(key: string | null = "r8_test-token"): ModelProvider {
  return createReplicateProvider({ getKey: () => key, now: () => NOW })
}

describe("createReplicateProvider", () => {
  let provider: ModelProvider

  beforeEach(() => {
    useReadOnlyApi()
    provider = makeProvider()
  })

  it("reports whether a key is configured", () => {
    expect(provider.isConfigured()).toBe(true)
    expect(makeProvider(null).isConfigured()).toBe(false)
    expect(makeProvider("  ").isConfigured()).toBe(false)
  })

  it("refuses to call the API without a key", async () => {
    await expect(
      makeProvider(null).getModel("bytedance/seedance-2.5")
    ).rejects.toThrow(/api key/i)
  })

  it("maps a Replicate model to a descriptor with its JSON Schema", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.key).toBe("replicate:bytedance/seedance-2.5")
    expect(d.provider).toBe("replicate")
    expect(d.slug).toBe("bytedance/seedance-2.5")
    expect(d.kind).toBe("video")
    expect(d.versionId).toEqual(expect.any(String))
    expect(d.fetchedAt).toBe(NOW)
    expect(Object.keys(d.inputSchema.properties as object)).toContain(
      "reference_images"
    )
    expect(d.outputSchema).toMatchObject({ type: "string", format: "uri" })
    expect(d.raw).toMatchObject({ owner: "bytedance", name: "seedance-2.5" })
  })

  it("derives reference slots from the schema", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    const fields = d.referenceSlots.map((s) => s.field).sort()
    expect(fields).toEqual([
      "image",
      "last_frame_image",
      "reference_audios",
      "reference_images",
      "reference_videos",
    ])

    const refs = d.referenceSlots.find((s) => s.field === "reference_images")!
    expect(refs.multiple).toBe(true)
    expect(refs.role).toBe("reference")
    expect(refs.kind).toBe("image")
    expect(refs.max).toBe(30)
    expect(
      d.referenceSlots.find((s) => s.field === "last_frame_image")!.role
    ).toBe("last_frame")
  })

  it("lifts prompt/duration/resolution/aspect_ratio into common controls", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.commonControls).toEqual({
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
    })
  })

  it("leaves common controls null for a model that has no such input", async () => {
    const d = await provider.getModel("google/nano-banana-pro")

    expect(d.commonControls).toEqual({
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: null,
      resolution: "resolution",
      seed: null,
      audio: null,
    })
    expect(d.kind).toBe("image")
  })

  it("dereferences Cog enum $refs so the form can render them", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")
    const properties = d.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >

    expect(properties.resolution).toMatchObject({
      type: "string",
      enum: ["480p", "720p"],
      default: "720p",
    })
    expect(properties.resolution).not.toHaveProperty("allOf")
    expect(JSON.stringify(d.inputSchema)).not.toContain("$ref")
    // The `description` on the referring property wins over the enum's own.
    expect(properties.resolution!.description).toMatch(/Video resolution/)
  })

  it("reports pricing as local-table with an explicit note", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.pricing.source).toBe("local_table")
    expect(d.pricing.basis).toBe("per_second")
    expect(d.pricing.note).toMatch(/not exposed/i)
    expect(d.pricing.skus).toMatchObject({ "720p": "0.2312" })
    expect(d.pricing.estimate).toBeNull()
  })

  it("keeps unrecognised fields — they are never dropped", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")
    const properties = Object.keys(d.inputSchema.properties as object)

    expect(properties).toContain("watermark")
    expect(properties).toContain("output_format")
    // Every property the recorded schema declares survives the mapping.
    expect(properties.sort()).toEqual(
      Object.keys(recordedInputProperties("model-seedance-2.5")).sort()
    )
  })

  it("has no price for a model missing from the local pricing table", async () => {
    server.use(
      http.get("https://api.replicate.com/v1/models/acme/mystery", () =>
        HttpResponse.json({
          ...fixture("model-seedance-2.5"),
          owner: "acme",
          name: "mystery",
        })
      )
    )

    const d = await provider.getModel("acme/mystery")

    expect(d.pricing.source).toBe("none")
    expect(d.pricing.estimate).toBeNull()
    expect(d.pricing.note).toMatch(/no published rate/i)
  })

  it("rejects a slug that is not owner/name", async () => {
    await expect(provider.getModel("seedance")).rejects.toThrow(/owner\/name/)
  })

  describe("listModels", () => {
    it("seeds the catalog from the collections, deduplicated by slug", async () => {
      const summaries = await provider.listModels({
        kinds: ["video", "image", "other"],
      })

      const slugs = summaries.map((s) => s.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
      expect(slugs).toContain("bytedance/seedance-2.0")
      expect(slugs).toContain("google/nano-banana-2")
      expect(summaries[0]!.key).toBe(`replicate:${summaries[0]!.slug}`)
    })

    it("takes the kind from the collection a model appears in", async () => {
      const summaries = await provider.listModels({ kinds: ["video", "image"] })
      const bySlug = new Map(summaries.map((s) => [s.slug, s]))

      expect(bySlug.get("bytedance/seedance-2.0")!.kind).toBe("video")
      expect(bySlug.get("google/nano-banana-2")!.kind).toBe("image")
    })

    it("infers a kind for a model only the untyped `official` collection lists", async () => {
      const summaries = await provider.listModels({ kinds: ["video"] })
      const seedance25 = summaries.find(
        (s) => s.slug === "bytedance/seedance-2.5"
      )

      expect(seedance25).toBeDefined()
      expect(seedance25!.kind).toBe("video")
    })

    it("filters by the requested kinds", async () => {
      const summaries = await provider.listModels({ kinds: ["image"] })

      expect(summaries.length).toBeGreaterThan(0)
      expect(summaries.every((s) => s.kind === "image")).toBe(true)
    })

    it("skips a collection the API does not serve rather than failing", async () => {
      // Only `text-to-video`/`text-to-image`/`official` have fixtures; the
      // other seed collections 404 and must not break the listing.
      await expect(
        provider.listModels({ kinds: ["video", "image"] })
      ).resolves.not.toHaveLength(0)
    })

    it("surfaces a rejected key instead of returning an empty catalog", async () => {
      server.use(
        http.get("https://api.replicate.com/v1/collections/text-to-video", () =>
          HttpResponse.json({ detail: "Invalid token." }, { status: 401 })
        )
      )

      await expect(
        provider.listModels({ kinds: ["video", "image"] })
      ).rejects.toThrow(/rejected the Replicate API key/i)
    })

    it("reuses the collection index when a descriptor is fetched afterwards", async () => {
      await provider.listModels({ kinds: ["video", "image"] })
      const d = await provider.getModel("bytedance/seedance-2.0")

      expect(d.kind).toBe("video")
    })
  })

  describe("submit / poll / cancel", () => {
    const prediction = (overrides: Record<string, unknown> = {}) => ({
      id: "pred-123",
      model: "bytedance/seedance-2.5",
      version: "v1",
      status: "starting",
      input: { prompt: "a cat" },
      created_at: "2026-09-16T00:00:00Z",
      source: "api",
      data_removed: false,
      urls: {
        get: "https://api.replicate.com/v1/predictions/pred-123",
        cancel: "https://api.replicate.com/v1/predictions/pred-123/cancel",
      },
      ...overrides,
    })

    it("submits a prediction pinned to the version and returns a job ref", async () => {
      let body: Record<string, unknown> | null = null
      server.use(
        http.post(
          "https://api.replicate.com/v1/predictions",
          async ({ request }) => {
            body = (await request.json()) as Record<string, unknown>
            return HttpResponse.json(prediction(), { status: 201 })
          }
        )
      )

      const ref = await provider.submit({
        slug: "bytedance/seedance-2.5",
        versionId: "ver-abc",
        params: { prompt: "a cat", duration: 5 },
      })

      expect(body).toEqual({
        version: "ver-abc",
        input: { prompt: "a cat", duration: 5 },
      })
      expect(ref).toEqual({
        provider: "replicate",
        id: "pred-123",
        pollUrl: "https://api.replicate.com/v1/predictions/pred-123",
      })
    })

    it("submits against the model's own endpoint when no version is pinned", async () => {
      let body: Record<string, unknown> | null = null
      server.use(
        // The SDK routes an unpinned run to the model endpoint rather than
        // putting the slug in the body.
        http.post(
          "https://api.replicate.com/v1/models/bytedance/seedance-2.5/predictions",
          async ({ request }) => {
            body = (await request.json()) as Record<string, unknown>
            return HttpResponse.json(prediction(), { status: 201 })
          }
        )
      )

      const ref = await provider.submit({
        slug: "bytedance/seedance-2.5",
        params: { prompt: "a cat" },
      })

      expect(body).toEqual({ input: { prompt: "a cat" } })
      expect(ref.id).toBe("pred-123")
    })

    it.each([
      ["starting", "queued"],
      ["processing", "running"],
      ["succeeded", "succeeded"],
      ["failed", "failed"],
      ["canceled", "canceled"],
      ["aborted", "failed"],
    ])("maps the %s prediction status to %s", async (status, expected) => {
      server.use(
        http.get("https://api.replicate.com/v1/predictions/pred-123", () =>
          HttpResponse.json(prediction({ status }))
        )
      )

      const state = await provider.poll({
        provider: "replicate",
        id: "pred-123",
      })

      expect(state.status).toBe(expected)
    })

    it("normalizes a single output URL and a list of them", async () => {
      server.use(
        http.get("https://api.replicate.com/v1/predictions/pred-123", () =>
          HttpResponse.json(
            prediction({
              status: "succeeded",
              output: "https://replicate.delivery/out.mp4",
            })
          )
        ),
        http.get("https://api.replicate.com/v1/predictions/pred-456", () =>
          HttpResponse.json(
            prediction({
              id: "pred-456",
              status: "succeeded",
              output: [
                "https://replicate.delivery/a.png",
                "https://replicate.delivery/b.png",
              ],
            })
          )
        )
      )

      const one = await provider.poll({ provider: "replicate", id: "pred-123" })
      const many = await provider.poll({
        provider: "replicate",
        id: "pred-456",
      })

      expect(one.outputUrls).toEqual(["https://replicate.delivery/out.mp4"])
      expect(many.outputUrls).toEqual([
        "https://replicate.delivery/a.png",
        "https://replicate.delivery/b.png",
      ])
      expect(one.costUsd).toBeNull()
      expect(one.progress).toBeNull()
    })

    it("surfaces the provider error message on a failed prediction", async () => {
      server.use(
        http.get("https://api.replicate.com/v1/predictions/pred-123", () =>
          HttpResponse.json(
            prediction({ status: "failed", error: "NSFW content detected" })
          )
        )
      )

      const state = await provider.poll({
        provider: "replicate",
        id: "pred-123",
      })

      expect(state.status).toBe("failed")
      expect(state.error).toBe("NSFW content detected")
      expect(state.outputUrls).toEqual([])
    })

    it("cancels a prediction", async () => {
      let canceled = false
      server.use(
        http.post(
          "https://api.replicate.com/v1/predictions/pred-123/cancel",
          () => {
            canceled = true
            return HttpResponse.json(prediction({ status: "canceled" }))
          }
        )
      )

      await provider.cancel({ provider: "replicate", id: "pred-123" })

      expect(canceled).toBe(true)
    })
  })
})

describe("dereferenceCogSchema", () => {
  const schemas = {
    resolution: {
      enum: ["480p", "720p"],
      type: "string",
      title: "resolution",
      description: "An enumeration.",
    },
  }

  it("resolves a $ref into the referenced schema", () => {
    expect(
      dereferenceCogSchema({ $ref: "#/components/schemas/resolution" }, schemas)
    ).toEqual(schemas.resolution)
  })

  it("collapses Cog's single-entry allOf and keeps the sibling keywords", () => {
    expect(
      dereferenceCogSchema(
        {
          allOf: [{ $ref: "#/components/schemas/resolution" }],
          default: "720p",
          "x-order": 7,
          description: "Video resolution.",
        },
        schemas
      )
    ).toEqual({
      enum: ["480p", "720p"],
      type: "string",
      title: "resolution",
      default: "720p",
      "x-order": 7,
      description: "Video resolution.",
    })
  })

  it("merges a multi-entry allOf left to right", () => {
    expect(
      dereferenceCogSchema(
        { allOf: [{ type: "string" }, { minLength: 2 }] },
        schemas
      )
    ).toEqual({ type: "string", minLength: 2 })
  })

  it("recurses into properties and array items", () => {
    expect(
      dereferenceCogSchema(
        {
          type: "object",
          properties: {
            res: { $ref: "#/components/schemas/resolution" },
            many: {
              type: "array",
              items: { $ref: "#/components/schemas/resolution" },
            },
          },
        },
        schemas
      )
    ).toEqual({
      type: "object",
      properties: {
        res: schemas.resolution,
        many: { type: "array", items: schemas.resolution },
      },
    })
  })

  it("leaves an unresolvable $ref alone rather than dropping the property", () => {
    expect(
      dereferenceCogSchema({ $ref: "#/components/schemas/nope" }, schemas)
    ).toEqual({ $ref: "#/components/schemas/nope" })
    expect(
      dereferenceCogSchema({ $ref: "https://example.test/x" }, schemas)
    ).toEqual({ $ref: "https://example.test/x" })
  })

  it("does not loop on a self-referential schema", () => {
    const cyclic = { self: { $ref: "#/components/schemas/self" } }
    expect(
      dereferenceCogSchema({ $ref: "#/components/schemas/self" }, cyclic)
    ).toEqual({ $ref: "#/components/schemas/self" })
  })
})
