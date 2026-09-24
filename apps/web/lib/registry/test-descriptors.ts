/**
 * Descriptors for the mapping editor's tests, built from the schemas the
 * providers really published (`test/fixtures/`), read off disk rather than
 * retyped, so a row the editor would draw wrong for a real model fails here.
 *
 * The slot rule and the role guesses restate `deriveReferenceSlots` in
 * miniature: the real one lives behind the IPC boundary, in main.
 *
 * ⛔ Test-only. No network; the fixtures are files.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  unknownPricing,
  type ModelDescriptor,
  type ModelFamily,
  type ReferenceSlot,
} from "@opendirect/contract"

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJson(...path: string[]): Json {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), ...path), "utf8")
  ) as Json
}

/** Cog's `allOf: [{ $ref }]` enums, flattened as the Replicate adapter does. */
function dereference(schema: unknown, schemas: Json): unknown {
  if (Array.isArray(schema)) return schema.map((s) => dereference(s, schemas))
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

const ROLE_HINTS: Array<[RegExp, ReferenceSlot["role"]]> = [
  [/^(first_frame|start_image)$/i, "first_frame"],
  [/^(last_frame|last_frame_image|end_image)$/i, "last_frame"],
]

function slotsOf(inputSchema: Json): ReferenceSlot[] {
  const properties = isObject(inputSchema.properties)
    ? inputSchema.properties
    : {}
  const uri = (s: unknown) =>
    isObject(s) && s.type === "string" && s.format === "uri"
  const slots: ReferenceSlot[] = []
  for (const [field, schema] of Object.entries(properties)) {
    if (!isObject(schema)) continue
    const multiple = schema.type === "array" && uri(schema.items)
    if (!multiple && !uri(schema)) continue
    const description =
      typeof schema.description === "string" ? schema.description : ""
    const upTo = /\bup to (\d+)\b/i.exec(description)
    slots.push({
      field,
      label: typeof schema.title === "string" ? schema.title : field,
      kind: /video/i.test(field)
        ? "video"
        : /audio/i.test(field)
          ? "audio"
          : "image",
      multiple,
      max: multiple && upTo ? Number(upTo[1]) : null,
      role:
        ROLE_HINTS.find(([pattern]) => pattern.test(field))?.[1] ?? "reference",
      verified: false,
      required: false,
      shape: null,
    })
  }
  return slots
}

export function descriptorFor(
  provider: ModelDescriptor["provider"],
  slug: string,
  inputSchema: Json,
  overrides: Partial<ModelDescriptor> = {}
): ModelDescriptor {
  const properties = isObject(inputSchema.properties)
    ? inputSchema.properties
    : {}
  const present = (field: string) => (field in properties ? field : null)
  return {
    key: `${provider}:${slug}`,
    provider,
    slug,
    name: slug,
    description: null,
    kind: "video",
    versionId: null,
    coverImageUrl: null,
    inputSchema,
    outputSchema: null,
    referenceSlots: slotsOf(inputSchema),
    commonControls: {
      prompt: present("prompt"),
      aspectRatio: present("aspect_ratio"),
      duration: present("duration"),
      resolution: present("resolution"),
      seed: present("seed"),
      audio: present("generate_audio"),
    },
    pricing: unknownPricing,
    raw: null,
    fetchedAt: 0,
    family: null,
    mappedBy: null,
    ...overrides,
  }
}

/** Replicate's `bytedance/seedance-2.5`, as recorded. */
export function seedanceDescriptor(
  overrides: Partial<ModelDescriptor> = {}
): ModelDescriptor {
  const recorded = readJson(
    "test/fixtures/replicate/model-seedance-2.5.json"
  ) as {
    latest_version: { openapi_schema: { components: { schemas: Json } } }
  }
  const schemas = recorded.latest_version.openapi_schema.components.schemas
  const input = dereference(schemas.Input, schemas) as Json
  return descriptorFor("replicate", "bytedance/seedance-2.5", input, {
    name: "Seedance 2.5",
    ...overrides,
  })
}

/** The bundled `registry/models/seedance-2-5.json`, as shipped. */
export function bundledSeedance(): ModelFamily {
  return readJson("registry/models/seedance-2-5.json") as unknown as ModelFamily
}
