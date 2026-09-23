/**
 * The model-registry file format (design §3,
 * docs/plans/2026-09-24-model-registry-design.md).
 *
 * The unit is a **model family** that spans providers: one file per family
 * under `registry/models/<id>.json`, each listing the endpoints (a provider
 * plus its model slug) that run it. An endpoint maps **slot keys** (a role,
 * plus `:2`–`:9` when a role repeats) to the provider's input fields, and the
 * canonical **controls** to its scalar fields, so the UI speaks one
 * vocabulary whatever provider runs the model.
 *
 * The same schemas validate bundled files, the remote copy and the user's own
 * mappings, so every validation message is a sentence a person can act on in
 * the mapping editor.
 *
 * ⛔ A mapping is data only. A `shape` can only NAME one of the app's
 * `SHAPES`; nothing here lets a remote file run code.
 */
import { z } from "zod"

import { providerIdSchema } from "../provider"
import { REFERENCE_ROLES, type ReferenceRole } from "../roles"
import { SHAPE_NAMES, isShapeName } from "./shapes"

/**
 * The file format this app reads. Bump it (and teach the app the new format)
 * on any breaking change — including a change to the role list.
 */
export const REGISTRY_FORMAT = 1

export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/venkatesh-sekar/opendirect/main/registry"

/** The canonical scalar controls a mapping can rename. */
export const controlNameSchema = z.enum([
  "prompt",
  "negative_prompt",
  "aspect_ratio",
  "duration",
  "resolution",
  "seed",
  "generate_audio",
  "count",
])
export type ControlName = z.output<typeof controlNameSchema>
export const CONTROL_NAMES = controlNameSchema.options

/** `character`, `reference:2` … — a role, plus :2–:9 when a role repeats. */
export const slotKeySchema = z
  .string()
  .regex(new RegExp(`^(${REFERENCE_ROLES.join("|")})(:[2-9])?$`), {
    error: (issue) =>
      `"${String(issue.input)}" is not a slot key. Use a role (${REFERENCE_ROLES.join(", ")}), optionally followed by :2–:9.`,
  })

/** `reference:2` → `reference`. */
export function slotKeyRole(key: string): ReferenceRole {
  return key.split(":")[0] as ReferenceRole
}

/** `reference:2` → 2; a bare role is position 1. */
export function slotKeyPosition(key: string): number {
  const suffix = key.split(":")[1]
  return suffix === undefined ? 1 : Number(suffix)
}

/** Lowercase letters, digits and dashes — safe as a file name and in a key. */
export const familyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, {
  error:
    "A family id is 1–64 lowercase letters, digits and dashes, starting with a letter or digit.",
})

export const mappingInputSchema = z.strictObject({
  field: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "any"]),
  required: z.boolean().optional(),
  max: z.number().int().positive().optional(),
  label: z.string().min(1).max(80).optional(),
  shape: z.string().optional(),
})
export type MappingInput = z.output<typeof mappingInputSchema>

export const mappingControlSchema = z.strictObject({
  field: z.string().min(1),
  /** canonical value → provider value */
  values: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
})
export type MappingControl = z.output<typeof mappingControlSchema>

export const mappingEndpointSchema = z
  .strictObject({
    provider: providerIdSchema,
    model: z.string().min(1),
    inputs: z.record(slotKeySchema, mappingInputSchema).default({}),
    controls: z
      .partialRecord(controlNameSchema, mappingControlSchema)
      .default({}),
  })
  .superRefine((endpoint, ctx) => {
    const inputs = Object.entries(endpoint.inputs)

    // 1. One provider field per input.
    const inputByField = new Map<string, string>()
    for (const [key, input] of inputs) {
      const other = inputByField.get(input.field)
      if (other !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["inputs", key, "field"],
          message: `Field "${input.field}" is mapped by both "${other}" and "${key}". Map each provider field once.`,
        })
      } else {
        inputByField.set(input.field, key)
      }

      // 3. Shapes are code the app ships; a mapping can only name one.
      if (input.shape !== undefined && !isShapeName(input.shape)) {
        ctx.addIssue({
          code: "custom",
          path: ["inputs", key, "shape"],
          message: `Unknown shape "${input.shape}". A mapping can only name a shape the app ships: ${SHAPE_NAMES.join(", ")}.`,
        })
      }

      // 4. `role:n` needs the position before it.
      const position = slotKeyPosition(key)
      if (position > 1) {
        const role = slotKeyRole(key)
        const previous = position === 2 ? role : `${role}:${position - 1}`
        if (!Object.hasOwn(endpoint.inputs, previous)) {
          ctx.addIssue({
            code: "custom",
            path: ["inputs", key],
            message: `"${key}" needs "${previous}". Number repeated roles in order, starting from the bare role.`,
          })
        }
      }
    }

    for (const [name, control] of Object.entries(endpoint.controls)) {
      if (control === undefined) continue
      // 2. A field is either an input or a control, never both.
      const input = inputByField.get(control.field)
      if (input !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["controls", name, "field"],
          message: `Control "${name}" maps "${control.field}", which input "${input}" already maps. A field is either an input or a control.`,
        })
      }
      // 5. `count` is a number of runs, not a vocabulary.
      if (name === "count" && control.values !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["controls", name, "values"],
          message: `The "count" control cannot map values; it is always a number. Remove "values".`,
        })
      }
    }
  })
export type MappingEndpoint = z.output<typeof mappingEndpointSchema>

export const modelFamilySchema = z
  .strictObject({
    $schema: z.string().optional(),
    id: familyIdSchema,
    name: z.string().min(1).max(80),
    kind: z.enum(["video", "image", "audio"]),
    description: z.string().max(500).optional(),
    endpoints: z.array(mappingEndpointSchema).min(1),
  })
  .superRefine((family, ctx) => {
    const seen = new Set<string>()
    family.endpoints.forEach((endpoint, index) => {
      const key = `${endpoint.provider}:${endpoint.model}`
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["endpoints", index],
          message: `Endpoint ${key} is listed twice. List each provider model once.`,
        })
      }
      seen.add(key)
    })
  })
export type ModelFamily = z.output<typeof modelFamilySchema>

/**
 * `registry/index.json`. `format` is read as a number so a newer format
 * produces a clear warning, not a parse error.
 */
export const registryIndexSchema = z.strictObject({
  format: z.number().int().positive(),
  registryVersion: z.number().int().nonnegative(),
  families: z.array(familyIdSchema),
})
export type RegistryIndex = z.output<typeof registryIndexSchema>

/** The layers, lowest first; a later layer replaces a family by id. */
export const registrySourceSchema = z.enum(["bundled", "remote", "user"])
export type RegistrySource = z.output<typeof registrySourceSchema>

export const registryWarningSchema = z.object({
  source: registrySourceSchema,
  familyId: z.string().nullable(),
  message: z.string(),
})
export type RegistryWarning = z.output<typeof registryWarningSchema>

export const registryFamilyEntrySchema = z.object({
  family: modelFamilySchema,
  source: registrySourceSchema,
  /** Lower layers this entry replaced, e.g. ["bundled"]. */
  shadows: z.array(registrySourceSchema),
  warnings: z.array(z.string()),
})
export type RegistryFamilyEntry = z.output<typeof registryFamilyEntrySchema>

export const registryStatusSchema = z.object({
  format: z.number(),
  bundledVersion: z.number(),
  activeVersion: z.number(),
  activeSource: z.enum(["bundled", "remote"]),
  remote: z.object({
    enabled: z.boolean(),
    url: z.string(),
    version: z.number().nullable(),
    fetchedAt: z.number().nullable(),
    error: z.string().nullable(),
  }),
  overrides: z.number(),
  families: z.number(),
  warnings: z.array(registryWarningSchema),
})
export type RegistryStatus = z.output<typeof registryStatusSchema>

/**
 * One validation problem, addressed so a form can put it under the row it is
 * about: `path` is dotted into the family (`endpoints.0.inputs.character.field`),
 * and empty for the family as a whole. The same shape as `SchemaIssue`.
 */
export const registryIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
})
export type RegistryIssue = z.output<typeof registryIssueSchema>

/**
 * `modelFamilySchema.safeParse`, flattened into every issue with its path —
 * main uses it to refuse a save, the mapping editor to show the same
 * messages under the same rows before the user ever presses Save.
 */
export function validateFamily(raw: unknown): {
  family: ModelFamily | null
  issues: RegistryIssue[]
} {
  const parsed = modelFamilySchema.safeParse(raw)
  if (parsed.success) return { family: parsed.data, issues: [] }
  return {
    family: null,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  }
}

/**
 * A user mapping as stored. `raw` is kept even when it no longer validates,
 * so it is listed with its issues and can be fixed rather than lost.
 */
export const userOverrideSchema = z.object({
  /**
   * The stored entry's own key, unique within the list: what a delete names.
   * Unlike `id` it exists for every entry, including one without an id or
   * one sharing an id with another after a hand-edit.
   */
  key: z.string(),
  /** `raw.id` when it is a string. */
  id: z.string().nullable(),
  raw: z.unknown(),
  /** Null when `raw` does not validate. */
  family: modelFamilySchema.nullable(),
  issues: z.array(registryIssueSchema),
  updatedAt: z.number(),
})
export type UserOverride = z.output<typeof userOverrideSchema>

/**
 * What saving a user mapping answers. A rejected save is an answer, not an
 * error: the issues come back with their paths, so the editor can show each
 * one under its row rather than one joined sentence.
 */
export const saveOverrideResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), override: userOverrideSchema }),
  z.object({ ok: z.literal(false), issues: z.array(registryIssueSchema) }),
])
export type SaveOverrideResult = z.output<typeof saveOverrideResultSchema>

/** Attached to family descriptors (`family:<id>`). */
export const familyInfoSchema = z.object({
  family: modelFamilySchema,
  source: registrySourceSchema,
  configured: z.array(providerIdSchema),
  providerOrder: z.array(providerIdSchema),
  override: providerIdSchema.nullable(),
  choice: z.object({
    /** Index into `family.endpoints`; null when no endpoint fits. */
    index: z.number().int().nullable(),
    /** Required slot keys not yet filled. */
    missing: z.array(z.string()),
    /** Filled keys no candidate endpoint takes. */
    unsupported: z.array(z.string()),
    message: z.string().nullable(),
  }),
})
export type FamilyInfo = z.output<typeof familyInfoSchema>
