/**
 * A model's own schema → the settings popover's icon grids.
 *
 * Three rows at most: quality, resolution, aspect ratio. The rule is strict
 * and it is the whole point of the module:
 *
 * - **A row exists only if the model's schema declares that field.** A model
 *   with no resolution field gets no resolution row.
 * - **The cells are exactly the enum values the schema lists, in schema
 *   order.** Nothing is padded to make the grid look even, nothing is
 *   reordered to look tidy, and nothing is renamed beyond title-casing a value
 *   that is plainly a word.
 * - **The partition stays total.** Resolution and aspect ratio are already
 *   promoted by `splitSchema`; quality is not, so the grid names the fields it
 *   took and `withoutIconGridFields` hands the rest to the Advanced form. The
 *   settings popover and Advanced between them still render every property.
 *
 * Icons are a label's companion, never its replacement: a resolution or a
 * quality cell always carries its own text, and an aspect ratio cell carries
 * the ratio it parsed so the component can draw the box at the real
 * proportions. A value we have no sensible icon for simply has none.
 */
import type { ModelDescriptor } from "@opendirect/contract"
import {
  AspectRatioIcon,
  Diamond01Icon,
  FlashIcon,
  FourKIcon,
  GaugeIcon,
  HdIcon,
  RectangularIcon,
  SmartPhone01Icon,
  SparklesIcon,
  SquareIcon,
} from "@hugeicons/core-free-icons"

import {
  enumOptions,
  humanizeField,
  labelFor,
  propertiesOf,
  splitSchema,
  type AdvancedSchema,
  type JsonSchema,
} from "../schema-form/split-schema"
import { parseAspectRatio, type AspectRatio } from "./layout"

/** The Hugeicons data array a cell renders. Kept structural so this file — and
 * its test — stay free of React. */
export type IconData = readonly unknown[]

export type IconGridKind = "quality" | "resolution" | "aspectRatio"

export interface IconGridCell {
  /** The schema's own value, submitted verbatim. */
  value: string
  /** What the cell reads. Always present — an icon never stands alone. */
  label: string
  /** Null when no icon says anything the label does not. */
  icon: IconData | null
  /** Parsed proportions, for an aspect-ratio cell the component draws. */
  ratio: AspectRatio | null
}

export interface IconGridRow {
  kind: IconGridKind
  /** The model's own field name — what the request is keyed by. */
  field: string
  label: string
  cells: IconGridCell[]
  /** The schema's stated default, when it states one. Never invented. */
  default: string | null
  required: boolean
}

export interface IconGrid {
  rows: IconGridRow[]
  /**
   * Every field the grid renders. The Advanced form drops these so no control
   * appears twice and none disappears.
   */
  fields: string[]
}

/**
 * Field names that read as an output quality preset. `output_quality` on a
 * Replicate model is a 0–100 integer rather than an enum, so it never becomes
 * a row — the enum check below is what decides, not the name.
 */
const QUALITY_FIELDS =
  /^(quality|output_quality|render_quality|quality_preset)$/i

const QUALITY_ICONS: Array<[RegExp, IconData]> = [
  [/^(draft|low|fast|turbo|lite|economy)$/i, FlashIcon],
  [/^(auto|default|balanced|standard|medium|mid|normal)$/i, GaugeIcon],
  [/^(high|hq|quality|fine)$/i, SparklesIcon],
  [/^(xhigh|x-high|max|maximum|ultra|best|pro|premium)$/i, Diamond01Icon],
]

const RESOLUTION_ICONS: Array<[RegExp, IconData]> = [
  [/(^|\D)(4k|8k|2160p?|4320p?)($|\D)/i, FourKIcon],
  [/(^|\D)(hd|1k|2k|720p?|1080p?|1440p?)($|\D)/i, HdIcon],
]

function iconFor(
  value: string,
  table: ReadonlyArray<[RegExp, IconData]>
): IconData | null {
  for (const [pattern, icon] of table) {
    if (pattern.test(value)) return icon
  }
  return null
}

/**
 * A shape for a ratio the model actually stated, and the generic
 * aspect-ratio glyph for the ones it does not — `auto`, `adaptive`,
 * `match_input_image`. Those are instructions, not proportions, so they get
 * no box.
 */
function aspectIcon(ratio: AspectRatio | null): IconData {
  if (!ratio) return AspectRatioIcon
  if (ratio.w === ratio.h) return SquareIcon
  return ratio.w > ratio.h ? RectangularIcon : SmartPhone01Icon
}

/**
 * `"match_input_image"` → `"Match Input Image"`, `"720p"` → `"720p"`.
 *
 * A value that already reads as one — a resolution, a ratio, anything with a
 * digit or a separator the schema chose — is left exactly as the model spells
 * it, because that is the string the provider will receive.
 */
export function cellLabel(value: string): string {
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/i.test(value)) {
    return humanizeField(value)
  }
  if (/^[a-z]+$/.test(value)) {
    return value.charAt(0).toUpperCase() + value.slice(1)
  }
  return value
}

function defaultOf(
  schema: JsonSchema,
  values: readonly string[]
): string | null {
  const stated = schema.default
  return typeof stated === "string" && values.includes(stated) ? stated : null
}

function buildRow(
  kind: IconGridKind,
  field: string,
  schema: JsonSchema,
  required: boolean
): IconGridRow | null {
  // Schema order, verbatim. A single-value enum is still a row: that is the
  // model saying it has exactly one setting, which is worth showing.
  const values = enumOptions(schema)
  if (values.length === 0) return null

  const cells = values.map((value): IconGridCell => {
    const ratio = kind === "aspectRatio" ? parseAspectRatio(value) : null
    const icon =
      kind === "aspectRatio"
        ? aspectIcon(ratio)
        : kind === "resolution"
          ? iconFor(value, RESOLUTION_ICONS)
          : iconFor(value, QUALITY_ICONS)
    return { value, label: cellLabel(value), icon, ratio }
  })

  return {
    kind,
    field,
    label: labelFor(field, schema),
    cells,
    default: defaultOf(schema, values),
    required,
  }
}

/**
 * The popover's rows, in the order it renders them: quality, resolution,
 * aspect ratio — coarsest decision first.
 *
 * Resolution and aspect ratio are taken from `splitSchema`'s promoted
 * controls, which is where the provider adapter already identified them
 * (`commonControls.resolution` covers a model that calls the field `size`).
 * Quality has no promoted control, so it is matched on the schema's own
 * property names and pulled out of Advanced by `withoutIconGridFields`.
 */
export function buildIconGrid(descriptor: ModelDescriptor): IconGrid {
  const split = splitSchema(descriptor)
  const properties = propertiesOf(descriptor.inputSchema as JsonSchema)
  const requiredList = (descriptor.inputSchema as JsonSchema).required
  const required = new Set(
    Array.isArray(requiredList)
      ? requiredList.filter((name): name is string => typeof name === "string")
      : []
  )
  const slotFields = new Set(
    descriptor.referenceSlots.map((slot) => slot.field)
  )

  const rows: IconGridRow[] = []

  // Quality: not a promoted control, so it is found in the schema itself —
  // and only when it is genuinely an enum of strings.
  for (const [field, schema] of Object.entries(properties)) {
    if (slotFields.has(field)) continue
    if (!QUALITY_FIELDS.test(field)) continue
    const row = buildRow("quality", field, schema, required.has(field))
    if (row) {
      rows.push(row)
      break
    }
  }

  for (const kind of ["resolution", "aspectRatio"] as const) {
    const common = split.common.find((entry) => entry.control === kind)
    if (!common) continue
    const row = buildRow(kind, common.field, common.schema, common.required)
    if (row) rows.push(row)
  }

  return { rows, fields: rows.map((row) => row.field) }
}

/**
 * The Advanced schema with the grid's fields removed, so the partition stays
 * total: grid ∪ remaining common ∪ slots ∪ advanced is still every property.
 */
export function withoutIconGridFields(
  advanced: AdvancedSchema,
  grid: IconGrid
): AdvancedSchema {
  const taken = new Set(grid.fields)
  const properties: Record<string, JsonSchema> = {}
  for (const [field, schema] of Object.entries(advanced.properties)) {
    if (taken.has(field)) continue
    properties[field] = schema
  }
  return {
    ...advanced,
    properties,
    required: advanced.required.filter((field) => field in properties),
  }
}

/** The chip's summary line: `High · 1080p · 16:9`. */
export function iconGridSummary(
  grid: IconGrid,
  values: Readonly<Record<string, unknown>>
): string {
  const parts: string[] = []
  for (const row of grid.rows) {
    const chosen = values[row.field] ?? row.default
    if (typeof chosen !== "string") continue
    const cell = row.cells.find((one) => one.value === chosen)
    if (cell) parts.push(cell.label)
  }
  return parts.join(" · ")
}
