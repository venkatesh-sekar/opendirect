/**
 * ⛔ Every request in this file is served by `msw` from recorded fixtures.
 * The fixtures under `test/fixtures/openrouter/` were captured once with
 * read-only `GET` calls to the model catalogs. `submit` / `poll` / `cancel`
 * are the paid path and are exercised **only** against these handlers — the
 * root harness runs msw with `onUnhandledRequest: "error"`, so an escape to
 * the live API fails the suite rather than spending money.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"

import { server } from "../../../../../test/msw/server"
import { ModelUnavailableError, createOpenRouterProvider } from "./openrouter"
import type { ModelProvider } from "./types"

function fixture(name: string): { data: unknown[] } {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/openrouter", `${name}.json`),
      "utf8"
    )
  ) as { data: unknown[] }
}

/** Serves the two capability catalogs, and nothing else. */
function useReadOnlyApi(): void {
  server.use(
    http.get("https://openrouter.ai/api/v1/videos/models", () =>
      HttpResponse.json(fixture("videos-models"))
    ),
    http.get("https://openrouter.ai/api/v1/images/models", () =>
      HttpResponse.json(fixture("images-models"))
    )
  )
}

const NOW = 1_758_000_000_000

function makeProvider(key: string | null = "sk-or-v1-test-key"): ModelProvider {
  return createOpenRouterProvider({ getKey: () => key, now: () => NOW })
}

type Props = Record<string, Record<string, unknown>>

describe("createOpenRouterProvider", () => {
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

  it("sends the key as a bearer token", async () => {
    let authorization: string | null = null
    server.use(
      http.get("https://openrouter.ai/api/v1/videos/models", ({ request }) => {
        authorization = request.headers.get("authorization")
        return HttpResponse.json(fixture("videos-models"))
      })
    )

    await provider.listModels({ kinds: ["video"] })

    expect(authorization).toBe("Bearer sk-or-v1-test-key")
  })

  it("lists video models from /api/v1/videos/models", async () => {
    const models = await provider.listModels({ kinds: ["video"] })

    expect(models.map((m) => m.slug)).toContain("bytedance/seedance-2.5")
    expect(models.length).toBeGreaterThan(20)
    expect(models.every((m) => m.kind === "video")).toBe(true)
    expect(models[0]!.key).toBe(`openrouter:${models[0]!.slug}`)
  })

  it("lists image models from /api/v1/images/models", async () => {
    const models = await provider.listModels({ kinds: ["image"] })

    expect(models.map((m) => m.slug)).toContain("openai/gpt-image-2.5-sunburst")
    expect(models.every((m) => m.kind === "image")).toBe(true)
  })

  it("fetches each catalog once and reuses it", async () => {
    let calls = 0
    server.use(
      http.get("https://openrouter.ai/api/v1/videos/models", () => {
        calls += 1
        return HttpResponse.json(fixture("videos-models"))
      })
    )

    await provider.listModels({ kinds: ["video"] })
    await provider.listModels({ kinds: ["video"] })
    await provider.getModel("bytedance/seedance-2.5")

    expect(calls).toBe(1)
  })

  it("synthesises a JSON Schema from seedance-2.5 capabilities", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")
    const props = d.inputSchema.properties as Props

    expect(d.key).toBe("openrouter:bytedance/seedance-2.5")
    expect(d.kind).toBe("video")
    expect(d.versionId).toBeNull()
    expect(d.fetchedAt).toBe(NOW)
    expect(props.prompt!.type).toBe("string")
    expect(props.duration!.enum).toEqual(expect.arrayContaining([4, 30]))
    expect(props.duration!.type).toBe("integer")
    expect(props.resolution!.enum).toEqual(["480p", "720p"])
    expect(props.aspect_ratio!.enum).toContain("21:9")
    expect(props.size!.enum).toContain("1280x720")
    expect(props.generate_audio!.type).toBe("boolean")
    expect(props.seed!.type).toBe("integer")
    expect(d.inputSchema.required).toEqual(["prompt"])
  })

  it("marks the schema as synthesised rather than published", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.inputSchema["x-opendirect-source"]).toBe("openrouter-capabilities")
    // OpenRouter publishes no output schema at all; we never invent one.
    expect(d.outputSchema).toBeNull()
  })

  it("turns supported_frame_images into first/last frame slots", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.referenceSlots.map((s) => s.role)).toEqual(
      expect.arrayContaining(["first_frame", "last_frame", "reference"])
    )
    const first = d.referenceSlots.find((s) => s.field === "first_frame")!
    expect(first).toMatchObject({ kind: "image", multiple: false, max: null })
    const refs = d.referenceSlots.find((s) => s.field === "input_references")!
    expect(refs).toMatchObject({ kind: "any", multiple: true })
  })

  it("omits a frame slot the model does not support", async () => {
    // A model that advertises only a first frame gets only that slot.
    const withoutFrames = (
      fixture("videos-models").data as Array<Record<string, unknown>>
    ).map((m) =>
      m.id === "bytedance/seedance-2.5"
        ? { ...m, supported_frame_images: ["first_frame"] }
        : m
    )
    server.use(
      http.get("https://openrouter.ai/api/v1/videos/models", () =>
        HttpResponse.json({ data: withoutFrames })
      )
    )

    const d = await provider.getModel("bytedance/seedance-2.5")
    const fields = d.referenceSlots.map((s) => s.field)

    expect(fields).toContain("first_frame")
    expect(fields).not.toContain("last_frame")
  })

  it("exposes allowed_passthrough_parameters under advanced, never dropped", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")
    const props = d.inputSchema.properties as Props

    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["watermark", "req_key", "output_format"])
    )
    expect(props.watermark!["x-opendirect-advanced"]).toBe(true)
    expect(props.prompt!["x-opendirect-advanced"]).toBeUndefined()
  })

  it("carries pricing_skus verbatim with provider_api as the source", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.pricing.source).toBe("provider_api")
    expect(d.pricing.skus.video_tokens).toBe("0.0000107")
    expect(d.pricing.basis).toBe("per_token")
    expect(d.pricing.estimate).toBeNull()
  })

  it("reads a per-second basis off a duration-priced model", async () => {
    const d = await provider.getModel("google/veo-3.1-lite")

    expect(d.pricing.basis).toBe("per_second")
    expect(d.pricing.skus).toMatchObject({
      duration_seconds_with_audio: "0.08",
    })
  })

  it("lifts the capability flags into common controls", async () => {
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

  it("maps image models' typed supported_parameters", async () => {
    const d = await provider.getModel("openai/gpt-image-2.5-sunburst")
    const props = d.inputSchema.properties as Props

    expect(d.kind).toBe("image")
    expect(props.aspect_ratio!.enum).toContain("16:9")
    expect(props.n).toMatchObject({ type: "integer", minimum: 1, maximum: 10 })
    expect(props.quality!.enum).toContain("high")
    const refs = d.referenceSlots.find((s) => s.field === "input_references")!
    expect(refs.max).toBe(16)
    expect(refs.kind).toBe("image")
    // `input_references` is a slot, not a number the form would ask for.
    expect(props.input_references!.type).toBe("array")
  })

  it("turns an image model's seed capability flag into a seed field", async () => {
    const d = await provider.getModel("qwen/qwen-image-3-pro")
    const props = d.inputSchema.properties as Props

    expect(props.seed).toMatchObject({ type: "integer" })
    expect(d.commonControls.seed).toBe("seed")
  })

  it("keeps a capability type it does not understand instead of dropping it", async () => {
    const patched = (
      fixture("images-models").data as Array<Record<string, unknown>>
    ).map((m) =>
      m.id === "openai/gpt-image-2.5-sunburst"
        ? {
            ...m,
            supported_parameters: {
              ...(m.supported_parameters as Record<string, unknown>),
              mystery: { type: "matrix", rows: 2 },
            },
          }
        : m
    )
    server.use(
      http.get("https://openrouter.ai/api/v1/images/models", () =>
        HttpResponse.json({ data: patched })
      )
    )

    const d = await provider.getModel("openai/gpt-image-2.5-sunburst")
    const props = d.inputSchema.properties as Props

    expect(props.mystery!["x-opendirect-capability"]).toEqual({
      type: "matrix",
      rows: 2,
    })
  })

  it("has no pricing for an image model, which publishes no SKUs", async () => {
    const d = await provider.getModel("openai/gpt-image-2.5-sunburst")

    expect(d.pricing.source).toBe("none")
    expect(d.pricing.skus).toEqual({})
    expect(d.pricing.note).toMatch(/reports the actual cost/i)
  })

  it("keeps the capability payload verbatim in raw", async () => {
    const d = await provider.getModel("bytedance/seedance-2.5")

    expect(d.raw).toEqual(
      (fixture("videos-models").data as Array<Record<string, unknown>>).find(
        (m) => m.id === "bytedance/seedance-2.5"
      )
    )
  })

  it("agrees with the generic model endpoint on which models produce video", async () => {
    // `GET /api/v1/models?output_modalities=video` is the other, generic view
    // of the same catalog. Recording both means a drift between them shows up
    // here rather than as a model the picker offers and cannot describe.
    const generic = (fixture("models").data as Array<{ id: string }>).map(
      (m) => m.id
    )
    const listed = (await provider.listModels({ kinds: ["video"] })).map(
      (m) => m.slug
    )

    expect([...listed].sort()).toEqual([...generic].sort())
  })

  describe("failure modes", () => {
    it("reports an unknown model as unavailable rather than crashing", async () => {
      await expect(provider.getModel("acme/ghost")).rejects.toBeInstanceOf(
        ModelUnavailableError
      )
      await expect(provider.getModel("acme/ghost")).rejects.toThrow(
        /unavailable/i
      )
    })

    it("treats a 404 from a catalog endpoint as unavailable", async () => {
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/models", () =>
          HttpResponse.json({ error: "Not found" }, { status: 404 })
        ),
        http.get("https://openrouter.ai/api/v1/images/models", () =>
          HttpResponse.json({ error: "Not found" }, { status: 404 })
        )
      )

      await expect(
        provider.getModel("bytedance/seedance-2.5")
      ).rejects.toBeInstanceOf(ModelUnavailableError)
    })

    it("surfaces a rejected key as an auth error", async () => {
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/models", () =>
          HttpResponse.json(
            { error: { message: "No auth credentials found" } },
            { status: 401 }
          )
        )
      )

      await expect(provider.listModels({ kinds: ["video"] })).rejects.toThrow(
        /rejected the OpenRouter API key/i
      )
    })

    it("does not cache a failed catalog fetch", async () => {
      let calls = 0
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/models", () => {
          calls += 1
          return calls === 1
            ? HttpResponse.json({ error: "boom" }, { status: 500 })
            : HttpResponse.json(fixture("videos-models"))
        })
      )

      await expect(provider.listModels({ kinds: ["video"] })).rejects.toThrow()
      await expect(
        provider.listModels({ kinds: ["video"] })
      ).resolves.not.toHaveLength(0)
      expect(calls).toBe(2)
    })
  })

  describe("submit / poll / cancel", () => {
    const job = (overrides: Record<string, unknown> = {}) => ({
      id: "vid-123",
      polling_url: "https://openrouter.ai/api/v1/videos/vid-123",
      status: "pending",
      ...overrides,
    })

    it("submits a video job and returns a job ref", async () => {
      let body: Record<string, unknown> | null = null
      server.use(
        http.post(
          "https://openrouter.ai/api/v1/videos",
          async ({ request }) => {
            body = (await request.json()) as Record<string, unknown>
            return HttpResponse.json(job())
          }
        )
      )

      const ref = await provider.submit({
        slug: "bytedance/seedance-2.5",
        params: {
          prompt: "a cat",
          duration: 5,
          resolution: "720p",
          aspect_ratio: "16:9",
          generate_audio: true,
          seed: 7,
          first_frame: "https://cdn.test/first.png",
          last_frame: "https://cdn.test/last.png",
          input_references: [
            "https://cdn.test/ref.png",
            "https://cdn.test/ref.mp4",
            "https://cdn.test/ref.mp3",
          ],
          watermark: false,
        },
      })

      expect(ref).toEqual({
        provider: "openrouter",
        id: "vid-123",
        pollUrl: "https://openrouter.ai/api/v1/videos/vid-123",
      })
      expect(body).toEqual({
        model: "bytedance/seedance-2.5",
        prompt: "a cat",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: true,
        seed: 7,
        frame_images: [
          {
            type: "image_url",
            frame_type: "first_frame",
            image_url: { url: "https://cdn.test/first.png" },
          },
          {
            type: "image_url",
            frame_type: "last_frame",
            image_url: { url: "https://cdn.test/last.png" },
          },
        ],
        input_references: [
          { type: "image_url", image_url: { url: "https://cdn.test/ref.png" } },
          { type: "video_url", video_url: { url: "https://cdn.test/ref.mp4" } },
          { type: "audio_url", audio_url: { url: "https://cdn.test/ref.mp3" } },
        ],
        // The passthrough parameter rides along untouched.
        watermark: false,
      })
    })

    it.each([
      ["pending", "queued"],
      ["in_progress", "running"],
      ["completed", "succeeded"],
      ["failed", "failed"],
      ["cancelled", "canceled"],
      ["expired", "failed"],
    ])("maps the %s job status to %s", async (status, expected) => {
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/vid-123", () =>
          HttpResponse.json(job({ status }))
        )
      )

      const state = await provider.poll({
        provider: "openrouter",
        id: "vid-123",
      })

      expect(state.status).toBe(expected)
    })

    it("reports the outputs and the exact cost of a finished job", async () => {
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/vid-123", () =>
          HttpResponse.json(
            job({
              status: "completed",
              unsigned_urls: ["https://cdn.test/out.mp4"],
              usage: { cost: 0.42, is_byok: false },
              generation_id: "gen-9",
            })
          )
        )
      )

      const state = await provider.poll({
        provider: "openrouter",
        id: "vid-123",
      })

      expect(state.outputUrls).toEqual(["https://cdn.test/out.mp4"])
      expect(state.costUsd).toBe(0.42)
      expect(state.progress).toBeNull()
      expect(state.error).toBeNull()
    })

    it("surfaces a failed job's error message", async () => {
      server.use(
        http.get("https://openrouter.ai/api/v1/videos/vid-123", () =>
          HttpResponse.json(
            job({ status: "failed", error: "provider said no" })
          )
        )
      )

      const state = await provider.poll({
        provider: "openrouter",
        id: "vid-123",
      })

      expect(state.status).toBe("failed")
      expect(state.error).toBe("provider said no")
      expect(state.outputUrls).toEqual([])
    })

    it("refuses to cancel a video job OpenRouter gives us no way to cancel", async () => {
      await expect(
        provider.cancel({ provider: "openrouter", id: "vid-123" })
      ).rejects.toThrow(/cannot be cancelled/i)
    })

    it("submits an image generation and polls it straight back", async () => {
      let body: Record<string, unknown> | null = null
      server.use(
        http.post(
          "https://openrouter.ai/api/v1/images/generations",
          async ({ request }) => {
            body = (await request.json()) as Record<string, unknown>
            return HttpResponse.json({
              created: 1,
              data: [{ b64_json: "AAAA", media_type: "image/png" }],
              usage: { cost: 0.03 },
            })
          }
        )
      )

      const ref = await provider.submit({
        slug: "openai/gpt-image-2.5-sunburst",
        params: {
          prompt: "a cat",
          n: 1,
          input_references: ["https://cdn.test/ref.png"],
        },
      })
      const state = await provider.poll(ref)

      expect(body).toEqual({
        model: "openai/gpt-image-2.5-sunburst",
        prompt: "a cat",
        n: 1,
        input_references: [
          { type: "image_url", image_url: { url: "https://cdn.test/ref.png" } },
        ],
      })
      expect(state.status).toBe("succeeded")
      expect(state.outputUrls).toEqual(["data:image/png;base64,AAAA"])
      expect(state.costUsd).toBe(0.03)
    })

    it("cancels a still-uncollected image generation locally", async () => {
      server.use(
        http.post("https://openrouter.ai/api/v1/images/generations", () =>
          HttpResponse.json({ created: 1, data: [{ b64_json: "AAAA" }] })
        )
      )

      const ref = await provider.submit({
        slug: "openai/gpt-image-2.5-sunburst",
        params: { prompt: "a cat" },
      })
      await provider.cancel(ref)
      const state = await provider.poll(ref)

      expect(state.status).toBe("canceled")
    })
  })
})
