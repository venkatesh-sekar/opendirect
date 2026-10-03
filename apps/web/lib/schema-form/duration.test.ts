import type { ModelDescriptor } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { modelDefaults } from "../create/draft"
import { buildGenerationRequest } from "../create/request"
import { settingsLayout } from "../create/settings-layout"
import {
  coerceDuration,
  currentDuration,
  durationInSeconds,
  durationSpec,
  findDurationField,
  formatDuration,
  parseSeconds,
} from "./duration"

type Json = Record<string, unknown>

/**
 * A video model with the given properties. The shapes below are the ones the
 * providers really publish (surveyed 2026-10-03), named after the model each
 * was read from.
 */
function model(
  properties: Json,
  over: Partial<ModelDescriptor> & { duration?: string | null } = {}
): ModelDescriptor {
  const { duration = null, ...rest } = over
  return {
    key: "replicate:test/video",
    provider: "replicate",
    slug: "test/video",
    name: "Test",
    description: null,
    kind: "video",
    versionId: null,
    coverImageUrl: null,
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: { prompt: { type: "string" }, ...properties },
    },
    outputSchema: null,
    referenceSlots: [],
    commonControls: {
      prompt: "prompt",
      aspectRatio: null,
      duration,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: null,
    raw: null,
    fetchedAt: 0,
    family: null,
    mappedBy: null,
    ...rest,
  } as unknown as ModelDescriptor
}

/** `alibaba/wan-3` on Replicate, as its schema states it. */
const wan3Replicate = model(
  {
    image: { type: "string", format: "uri" },
    negative_prompt: { type: "string", default: "" },
    resolution: { type: "string", enum: ["720p", "1080p"], default: "1080p" },
    aspect_ratio: {
      type: "string",
      enum: ["adaptive", "16:9", "9:16", "1:1"],
      default: "adaptive",
    },
    duration: { type: "integer", minimum: 2, maximum: 30, default: 5 },
    enable_prompt_expansion: { type: "boolean", default: true },
    seed: { type: "integer" },
  },
  {
    duration: "duration",
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: null,
    },
    referenceSlots: [
      {
        field: "image",
        label: "Image",
        kind: "image",
        multiple: false,
        max: null,
        role: "first_frame",
        verified: false,
        required: false,
        shape: null,
      },
    ],
  }
)

/** `openrouter:alibaba/wan-3.0`: `supported_durations` 2–30, no default. */
const wan3OpenRouter = model(
  {
    duration: {
      type: "integer",
      enum: Array.from({ length: 29 }, (_, i) => i + 2),
    },
    generate_audio: { type: "boolean" },
    seed: { type: "integer" },
  },
  {
    provider: "openrouter",
    commonControls: {
      prompt: "prompt",
      aspectRatio: null,
      duration: "duration",
      resolution: null,
      seed: "seed",
      audio: "generate_audio",
    },
  }
)

describe("parseSeconds", () => {
  it.each([
    [5, 5],
    ["5", 5],
    ["5s", 5],
    ["10 sec", 10],
    ["2.5 seconds", 2.5],
    ["-1", -1],
    ["five", null],
    ["", null],
    [null, null],
  ])("%j → %j", (input, expected) => {
    expect(parseSeconds(input)).toBe(expected)
  })
})

describe("durationSpec, across the shapes providers publish", () => {
  it("lists an integer range with its default (Wan 3 on Replicate)", () => {
    const spec = durationSpec(wan3Replicate)!
    expect(spec.field).toBe("duration")
    expect(spec.unit).toBe("seconds")
    expect(spec.choices).toHaveLength(29)
    expect(spec.choices![0]).toEqual({ value: 2, label: "2s" })
    expect(spec.choices!.at(-1)).toEqual({ value: 30, label: "30s" })
    expect(spec.default).toBe(5)
    expect(coerceDuration(spec, "10")).toBe(10)
    expect(coerceDuration(spec, "31")).toBeNull()
  })

  it("reads Seedance's −1 as Auto, and keeps it sendable", () => {
    const spec = durationSpec(
      model(
        { duration: { type: "integer", minimum: -1, maximum: 15, default: 5 } },
        { duration: "duration" }
      )
    )!
    expect(spec.choices![0]).toEqual({ value: -1, label: "Auto" })
    expect(coerceDuration(spec, "-1")).toBe(-1)
  })

  it("leaves an OpenRouter enum unset: it publishes no default", () => {
    const spec = durationSpec(wan3OpenRouter)!
    expect(spec.choices).toHaveLength(29)
    expect(spec.default).toBeNull()
    expect(currentDuration(spec, {})).toBeNull()
    expect(coerceDuration(spec, "12")).toBe(12)
  })

  it("offers an integer enum in schema order (Veo 3)", () => {
    const spec = durationSpec(
      model(
        { duration: { type: "integer", enum: [4, 6, 8], default: 8 } },
        { duration: "duration" }
      )
    )!
    expect(spec.choices!.map((c) => c.value)).toEqual([4, 6, 8])
    expect(spec.default).toBe(8)
  })

  it("sends a string enum back as the string it spells", () => {
    const suffixed = durationSpec(
      model(
        { duration: { type: "string", enum: ["5s", "10s"], default: "5s" } },
        { duration: "duration" }
      )
    )!
    expect(suffixed.choices!.map((c) => c.label)).toEqual(["5s", "10s"])
    expect(coerceDuration(suffixed, "10s")).toBe("10s")
    // A number for the same length still lands on the model's spelling.
    expect(coerceDuration(suffixed, 10)).toBe("10s")

    const bare = durationSpec(
      model(
        { duration: { type: "string", enum: ["5", "10"] } },
        { duration: "duration" }
      )
    )!
    expect(coerceDuration(bare, "10")).toBe("10")
    expect(bare.choices!.map((c) => c.label)).toEqual(["5s", "10s"])
  })

  it("finds Sora 2's `seconds` when the adapter promoted nothing", () => {
    const descriptor = model({
      seconds: { type: "integer", enum: [4, 8, 12], default: 4 },
    })
    expect(findDurationField(descriptor)).toBe("seconds")
    expect(durationSpec(descriptor)!.default).toBe(4)
  })

  it("lists whole seconds of a bounded number, sent as numbers", () => {
    const spec = durationSpec(
      model(
        { duration: { type: "number", minimum: 1, maximum: 10.5 } },
        { duration: "duration" }
      )
    )!
    expect(spec.choices!.map((c) => c.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })

  it("gives a range too wide to list a number input that clamps", () => {
    const spec = durationSpec(
      model(
        { duration: { type: "integer", minimum: 1, maximum: 600 } },
        { duration: "duration" }
      )
    )!
    expect(spec.choices).toBeNull()
    expect(spec.range).toEqual({ min: 1, max: 600, integer: true })
    expect(coerceDuration(spec, "7.4")).toBe(7)
    expect(coerceDuration(spec, "900")).toBe(600)
    expect(coerceDuration(spec, "soon")).toBeNull()
  })

  it("counts frames for num_frames + frames_per_second (Wan 2.2)", () => {
    const spec = durationSpec(
      model({
        num_frames: { type: "integer", minimum: 81, maximum: 121, default: 81 },
        frames_per_second: {
          type: "integer",
          minimum: 5,
          maximum: 30,
          default: 16,
        },
      })
    )!
    expect(spec.field).toBe("num_frames")
    expect(spec.unit).toBe("frames")
    expect(spec.fpsField).toBe("frames_per_second")
    expect(spec.choices![0]!.label).toBe("81 frames")
    expect(durationInSeconds(spec, 81, {})).toBeCloseTo(81 / 16, 6)
    expect(durationInSeconds(spec, 81, { frames_per_second: 27 })).toBe(3)
  })

  it("counts frames for video_length + fps (Hunyuan)", () => {
    const spec = durationSpec(
      model({
        video_length: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 129,
        },
        fps: { type: "integer", minimum: 1, default: 24 },
      })
    )!
    expect(spec.field).toBe("video_length")
    expect(spec.unit).toBe("frames")
    expect(durationInSeconds(spec, 96, {})).toBe(4)
  })

  it("reads LTX's `length` enum as frames, never as seconds", () => {
    const spec = durationSpec(
      model({
        length: { type: "integer", enum: [97, 129, 161], default: 97 },
      })
    )!
    expect(spec.unit).toBe("frames")
    expect(spec.fpsField).toBeNull()
    expect(durationInSeconds(spec, 97, {})).toBeNull()
  })

  it("has no duration for a model that has none", () => {
    expect(durationSpec(model({ resolution: { type: "string" } }))).toBeNull()
    // `length` on an image model is not a clip length.
    expect(
      durationSpec(
        model({ length: { type: "integer", default: 3 } }, { kind: "image" })
      )
    ).toBeNull()
    // A duration-named field that is free text is not a length either.
    expect(durationSpec(model({ duration: { type: "string" } }))).toBeNull()
  })

  it("lets a registry mapping name the field", () => {
    const descriptor = model(
      {
        duration: { type: "integer", enum: [5] },
        clip_seconds: { type: "integer", enum: [4, 8] },
      },
      { duration: "clip_seconds" }
    )
    expect(findDurationField(descriptor)).toBe("clip_seconds")
  })

  it("formats lengths", () => {
    expect(formatDuration(5, "seconds")).toBe("5s")
    expect(formatDuration("10s", "seconds")).toBe("10s")
    expect(formatDuration(-1, "seconds")).toBe("Auto")
    expect(formatDuration(81, "frames")).toBe("81 frames")
  })
})

describe("the settings layout", () => {
  it("edits every input in exactly one place", () => {
    const layout = settingsLayout(wan3Replicate)
    expect(layout.duration?.field).toBe("duration")
    expect([...layout.inline].sort()).toEqual([
      "aspect_ratio",
      "duration",
      "prompt",
      "resolution",
    ])
    // Seed was promoted to a control nothing rendered; it is in Advanced now.
    expect(Object.keys(layout.advanced.properties).sort()).toEqual([
      "enable_prompt_expansion",
      "negative_prompt",
      "seed",
    ])
    const all = new Set([
      ...layout.inline,
      ...layout.split.slots.map((slot) => slot.field),
      ...Object.keys(layout.advanced.properties),
    ])
    const properties = (wan3Replicate.inputSchema as { properties: Json })
      .properties
    expect([...all].sort()).toEqual(Object.keys(properties).sort())
  })

  it("never leaves an OpenRouter model's Advanced empty of its seed and audio", () => {
    const layout = settingsLayout(wan3OpenRouter)
    expect(Object.keys(layout.advanced.properties).sort()).toEqual([
      "generate_audio",
      "seed",
    ])
  })

  it("seeds the duration default into the bar and sends it as an integer", () => {
    const { common, advanced } = modelDefaults(wan3Replicate)
    expect(common).toMatchObject({ duration: 5 })
    expect(advanced).toMatchObject({ enable_prompt_expansion: true })
    const request = buildGenerationRequest({
      descriptor: wan3Replicate,
      containerId: null,
      values: { prompt: "a lift", common, advanced, references: {} },
    })
    expect(request.params.duration).toBe(5)
  })
})
