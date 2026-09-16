// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The popover, against the schemas the providers really published.
 *
 * The descriptors here are built from the recorded fixtures under
 * `test/fixtures/` rather than retyped, so a row that would not survive a real
 * model fails here: `bytedance/seedance-2.5` has a resolution enum and no
 * quality field at all, and `openai/gpt-image-2.5-sunburst` has a quality enum
 * and no resolution field at all.
 *
 * ⛔ No network and no submission. These are files on disk; msw's
 * `onUnhandledRequest: "error"` never has anything to catch.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ModelDescriptor } from "@opendirect/contract"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildIconGrid } from "@/lib/canvas/icon-grid"

import { SettingsPopover } from "./settings-popover"

type Json = Record<string, unknown>

function fixture(provider: string, name: string): Json {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures", provider, `${name}.json`),
      "utf8"
    )
  ) as Json
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Cog's `allOf`/`$ref` enums, flattened the way the Replicate adapter does. */
function dereference(schema: unknown, schemas: Json): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => dereference(item, schemas))
  }
  if (!isObject(schema)) return schema
  const out: Json = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === "allOf" || key === "$ref") continue
    out[key] = dereference(value, schemas)
  }
  const ref = typeof schema.$ref === "string" ? schema.$ref : null
  if (ref?.startsWith("#/components/schemas/")) {
    Object.assign(
      out,
      dereference(schemas[ref.slice("#/components/schemas/".length)], schemas)
    )
  }
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      Object.assign(out, dereference(member, schemas) as Json)
    }
  }
  return out
}

function descriptorOf(overrides: Partial<ModelDescriptor>): ModelDescriptor {
  return {
    key: "replicate:test/model",
    provider: "replicate",
    slug: "test/model",
    name: "Test",
    description: null,
    kind: "image",
    versionId: null,
    coverImageUrl: null,
    inputSchema: {},
    outputSchema: null,
    referenceSlots: [],
    commonControls: {
      prompt: null,
      aspectRatio: null,
      duration: null,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: null,
    raw: null,
    fetchedAt: 0,
    ...overrides,
  } as ModelDescriptor
}

/** `bytedance/seedance-2.5`: resolution `480p`/`720p`, and no quality field. */
function seedance(): ModelDescriptor {
  const model = fixture("replicate", "model-seedance-2.5")
  const openapi = (model.latest_version as Json).openapi_schema as Json
  const schemas = (openapi.components as Json).schemas as Json
  return descriptorOf({
    key: "replicate:bytedance/seedance-2.5",
    slug: "bytedance/seedance-2.5",
    kind: "video",
    inputSchema: dereference(schemas.Input, schemas) as Json,
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
    },
  })
}

/** `openai/gpt-image-2.5-sunburst`: a quality enum, and no resolution at all. */
function gptImage(): ModelDescriptor {
  const listing = fixture(
    "openrouter",
    "image-endpoints-gpt-image-2.5-sunburst"
  )
  const endpoint = (listing.endpoints as Json[])[0]!
  const supported = endpoint.supported_parameters as Record<string, Json>

  const properties: Json = { prompt: { type: "string", title: "Prompt" } }
  for (const [field, spec] of Object.entries(supported)) {
    properties[field] =
      spec.type === "enum" && Array.isArray(spec.values)
        ? { type: "string", enum: spec.values }
        : { type: "integer", minimum: spec.min, maximum: spec.max }
  }

  return descriptorOf({
    key: "openrouter:openai/gpt-image-2.5-sunburst",
    provider: "openrouter",
    slug: "openai/gpt-image-2.5-sunburst",
    inputSchema: { type: "object", required: ["prompt"], properties },
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: null,
      // The adapter reads `resolution` then `size`; this model has neither.
      resolution: null,
      seed: null,
      audio: null,
    },
  })
}

async function open(
  descriptor: ModelDescriptor,
  values: Record<string, unknown> = {},
  onChange: (field: string, value: string) => void = () => {}
) {
  const user = userEvent.setup()
  render(
    <SettingsPopover
      grid={buildIconGrid(descriptor)}
      values={values}
      onChange={onChange}
    />
  )
  await user.click(screen.getByTestId("settings-chip"))
  await screen.findAllByTestId("icon-grid-row")
  return user
}

function rowFor(kind: string): HTMLElement | null {
  return (
    screen
      .getAllByTestId("icon-grid-row")
      .find((row) => row.dataset.kind === kind) ?? null
  )
}

afterEach(cleanup)

describe("SettingsPopover", () => {
  it("renders exactly the resolutions a real schema lists, and no quality row", async () => {
    await open(seedance())

    const resolution = rowFor("resolution")
    expect(resolution).not.toBeNull()
    expect(
      within(resolution!)
        .getAllByTestId("icon-grid-cell")
        .map((cell) => cell.dataset.value)
    ).toEqual(["480p", "720p"])

    // ⛔ The model declares no quality field, so there is no quality row.
    expect(rowFor("quality")).toBeNull()
  })

  it("renders a quality row for a model that has one, and no resolution row", async () => {
    await open(gptImage())

    const quality = rowFor("quality")
    expect(quality).not.toBeNull()
    expect(
      within(quality!)
        .getAllByTestId("icon-grid-cell")
        .map((cell) => cell.dataset.value)
    ).toEqual(["auto", "low", "medium", "high", "xhigh", "max"])

    expect(rowFor("resolution")).toBeNull()
  })

  it("draws an aspect-ratio cell at the real proportions", async () => {
    await open(seedance())

    const ratios = rowFor("aspectRatio")
    expect(ratios).not.toBeNull()
    const cells = within(ratios!).getAllByTestId("icon-grid-cell")
    expect(cells.map((cell) => cell.dataset.value)).toEqual([
      "16:9",
      "4:3",
      "1:1",
      "3:4",
      "9:16",
      "21:9",
      "adaptive",
    ])

    const wide = within(cells[0]!).getByTestId("ratio-box")
    expect(wide.style.width).toBe("18px")
    expect(wide.style.height).toBe("10.125px")

    const square = within(cells[2]!).getByTestId("ratio-box")
    expect(square.style.width).toBe(square.style.height)

    // `adaptive` is an instruction, not proportions, so it draws no box.
    expect(within(cells[6]!).queryByTestId("ratio-box")).toBeNull()
  })

  it("shows the schema's own default as chosen until the user chooses", async () => {
    await open(seedance())

    const resolution = rowFor("resolution")!
    expect(
      within(resolution).getByRole("radio", { name: /720p/ })
    ).toHaveAttribute("aria-checked", "true")
  })

  it("writes the schema's own value into the params", async () => {
    const onChange = vi.fn()
    const user = await open(seedance(), {}, onChange)

    await user.click(screen.getByRole("radio", { name: /480p/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("resolution", "480p")
  })

  it("summarises the chosen values on the chip", () => {
    render(
      <SettingsPopover
        grid={buildIconGrid(seedance())}
        values={{ resolution: "480p", aspect_ratio: "9:16" }}
        onChange={() => {}}
      />
    )
    expect(screen.getByTestId("settings-chip")).toHaveTextContent("480p · 9:16")
  })

  it("renders nothing at all for a model with none of the three fields", () => {
    const { container } = render(
      <SettingsPopover
        grid={buildIconGrid(
          descriptorOf({
            inputSchema: {
              type: "object",
              properties: { prompt: { type: "string" } },
            },
          })
        )}
        values={{}}
        onChange={() => {}}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
