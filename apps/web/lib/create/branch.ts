/**
 * Branching: turning a recorded run back into the creation bar's state.
 *
 * A branch is a *variant*, so it starts as an exact copy of what produced the
 * parent — the same model, the same parameters, the same reference assets —
 * and the only thing the user is asked to change is the prompt. That is why
 * nothing here invents a value: the params come from the row's own
 * `params_json` verbatim, and the references from the run's input slots in
 * their recorded order.
 *
 * ⛔ Pre-filling is not submitting. A branch only becomes a run when the user
 * presses Generate, exactly like any other.
 */
import type { AssetDto, GenerationDto } from "@opendirect/contract"

import { modelKeyOf } from "@/lib/model-key"

import type { SchemaSplit } from "../schema-form/split-schema"

export interface BranchSource {
  generation: GenerationDto
  inputs: readonly { slotField: string; position: number; asset: AssetDto }[]
}

export interface BranchPrefill {
  /** Catalog key of the model the parent ran on. */
  modelKey: string
  /** The parent's prompt, as the bar's prompt box should show it. */
  prompt: string
  /** The parent's params, still keyed by the model's own field names. */
  params: Record<string, unknown>
  /** Asset ids per reference slot, in their recorded order. */
  references: Record<string, string[]>
  /** The reference assets themselves, so the tray can draw chips at once. */
  assets: AssetDto[]
  parentGenerationId: string
}

/** A recorded blob that is not JSON is a corrupt row, not a crash. */
function paramsOf(generation: GenerationDto): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(generation.paramsJson)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function branchPrefill(source: BranchSource): BranchPrefill {
  const { generation } = source

  const ordered = [...source.inputs].sort((a, b) => a.position - b.position)
  const references: Record<string, string[]> = {}
  for (const input of ordered) {
    references[input.slotField] = [
      ...(references[input.slotField] ?? []),
      input.asset.id,
    ]
  }

  return {
    modelKey: modelKeyOf(generation),
    prompt: generation.prompt ?? "",
    params: paramsOf(generation),
    references,
    assets: ordered.map((input) => input.asset),
    parentGenerationId: generation.id,
  }
}

export interface PartitionedParams {
  /** The prompt control's value, when the model has one and it was set. */
  prompt: string | null
  /** Values for the promoted inline controls. */
  common: Record<string, unknown>
  /** Everything else the model accepts, for the Advanced form. */
  advanced: Record<string, unknown>
}

/**
 * Splits a flat param object the way the creation bar holds it.
 *
 * Reference slots are dropped: their values are asset ids that travel in the
 * request's `references`, and a slot field left in `params` would be sent
 * twice. An unrecognised field lands under Advanced rather than being
 * discarded — the same total-partition rule `splitSchema` follows.
 */
export function partitionParams(
  split: SchemaSplit,
  params: Readonly<Record<string, unknown>>
): PartitionedParams {
  const slotFields = new Set(split.slots.map((slot) => slot.field))
  const promptField =
    split.common.find((field) => field.control === "prompt")?.field ?? null
  const commonFields = new Set(
    split.common
      .filter((field) => field.control !== "prompt")
      .map((field) => field.field)
  )

  let prompt: string | null = null
  const common: Record<string, unknown> = {}
  const advanced: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(params)) {
    if (slotFields.has(field)) continue
    if (promptField !== null && field === promptField) {
      prompt = typeof value === "string" ? value : null
      continue
    }
    if (commonFields.has(field)) common[field] = value
    else advanced[field] = value
  }

  return { prompt, common, advanced }
}
