/**
 * Where each of a model's inputs is edited, for every composer.
 *
 * Three places, and between them every property the schema declares:
 *
 * - the **settings popover**: the icon grid (quality, resolution, aspect
 *   ratio) and the duration control;
 * - the **reference strip**: the model's asset slots;
 * - **Advanced**: everything else — negative prompt, seed, audio, prompt
 *   expansion, a frame rate, a field no version of OpenDirect has heard of.
 *
 * The rule is the one `splitSchema` states, applied to what is actually
 * *rendered*: a field promoted to a common control that no widget shows (a
 * seed, an audio switch, an aspect ratio that is not an enum) goes to
 * Advanced, so nothing a model takes can be out of reach.
 *
 * Pure: nothing here submits, fetches or spends.
 */
import type { ModelDescriptor } from "@opendirect/contract"

import { buildIconGrid, type IconGrid } from "../canvas/icon-grid"
import { durationSpec, type DurationSpec } from "../schema-form/duration"
import {
  propertiesOf,
  splitSchema,
  type AdvancedSchema,
  type JsonSchema,
  type SchemaSplit,
} from "../schema-form/split-schema"

export interface SettingsLayout {
  split: SchemaSplit
  grid: IconGrid
  duration: DurationSpec | null
  /** Fields the bar edits itself: the prompt, the grid's, the duration. */
  inline: Set<string>
  /** Every other non-slot property, for the Advanced form. */
  advanced: AdvancedSchema
}

export function settingsLayout(descriptor: ModelDescriptor): SettingsLayout {
  const split = splitSchema(descriptor)
  const grid = buildIconGrid(descriptor)
  const duration = durationSpec(descriptor)

  const inline = new Set<string>(grid.fields)
  const prompt = split.common.find((field) => field.control === "prompt")
  if (prompt) inline.add(prompt.field)
  if (duration) inline.add(duration.field)

  const inputSchema = descriptor.inputSchema as JsonSchema
  const slotFields = new Set(split.slots.map((slot) => slot.field))
  const properties: Record<string, JsonSchema> = {}
  for (const [field, schema] of Object.entries(propertiesOf(inputSchema))) {
    if (inline.has(field) || slotFields.has(field)) continue
    properties[field] = schema
  }
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter(
        (field): field is string =>
          typeof field === "string" && field in properties
      )
    : []

  return {
    split,
    grid,
    duration,
    inline,
    advanced: { type: "object", properties, required },
  }
}
