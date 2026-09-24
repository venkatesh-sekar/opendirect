"use client"

/**
 * Everything between a composition and the one call that spends money.
 *
 * A draft — prompt, model, parameters, count — becomes, in order: the prompt's
 * `@mentions` resolved for the chosen model, a `GenerationRequest`, its quote,
 * the requirements it still misses, how many jobs it will cost, and the one
 * sentence that says why Generate is disabled when it is.
 *
 * The canvas's prompt bar and a container page's generate panel both compose
 * runs, in very different shapes. This is what they share, so the two cannot
 * disagree about what a run is or what it costs: the bar adds its edges as
 * `inputs`, the panel adds nothing, and the rest is this hook.
 *
 * ⛔ `run` is the only thing here that spends, and only when the caller's
 * Generate button calls it. `useSubmitBatch` is called once per call and the
 * plan refuses while a submission is in flight or a quote is loading; an
 * unknown price must be accepted by the user before it can be run at all.
 */
import { useCallback, useMemo, useState } from "react"
import {
  planBatch,
  type CostQuote,
  type ModelDescriptor,
  type ModelKind,
} from "@opendirect/contract"

import {
  useCostEstimate,
  useSubmitBatch,
  type BatchSubmissionResult,
} from "@/hooks/use-generations"
import { useMentionSubjects } from "@/hooks/use-mentions"
import { familyChoice, type ModelQueryOptions } from "@/hooks/use-models"
import {
  isBlocked,
  type CanvasInputsResult,
} from "@/lib/canvas/edges-to-inputs"
import { groupReferences, quoteOf } from "@/lib/create/draft"
import {
  buildGenerationRequest,
  costParams,
  missingRequirements,
} from "@/lib/create/request"
import {
  countBySlot,
  mentionedContainerIds,
  resolveMentions,
  type MentionSubject,
} from "@/lib/mentions/resolve"

/**
 * The most results one click may ask for. It matches the cap
 * `generations:submitBatch` enforces in main, so a stepper can never ask for
 * a batch the handler would trim — the number on the button is the number of
 * runs that will be queued.
 */
export const MAX_BATCH = 16

/** What the user has composed, and nothing they have not. */
export interface GenerateDraft {
  prompt: string
  modelKey: string | null
  /** Promoted controls and the icon grid's fields, by the model's own names. */
  common: Record<string, unknown>
  /** The Advanced form's object. */
  advanced: Record<string, unknown>
  count: number
}

export interface GeneratePlanInput {
  draft: GenerateDraft
  /** The chosen model's descriptor, once `useModel` has it. */
  descriptor: ModelDescriptor | undefined
  /** True while that descriptor is still loading. */
  modelPending: boolean
  /** The modalities this composer may run. */
  kinds: readonly ModelKind[]
  /** Where the run's outputs are filed. */
  containerId: string | null
  /**
   * The canvas's edges, read into references and notes — or a sentence
   * saying why they cannot be. Off the canvas there are none.
   */
  inputs?: CanvasInputsResult
  /**
   * The prompt to resolve and send. The canvas passes its rendered blocks;
   * a container page passes nothing and `draft.prompt` is used.
   */
  prompt?: string
  /**
   * A family node's provider override and filled slot keys — what its
   * descriptor was fetched with (`modelOptionsForNode`), so the quote prices
   * the same endpoint. Ignored for a `provider:slug` key.
   */
  modelOptions?: ModelQueryOptions
  /**
   * What an accepted unknown price is scoped to, beyond the model, params and
   * count — the canvas node's id. Accepting the risk for one composition must
   * not accept it for another.
   */
  scope?: string
}

/** Frozen: the empty answer must not be a new array on every render. */
const NO_SUBJECTS: readonly MentionSubject[] = []
const NO_INPUTS: CanvasInputsResult = { references: [], notes: [] }
const NO_OPTIONS: ModelQueryOptions = {}

export function useGeneratePlan({
  draft,
  descriptor,
  modelPending,
  kinds,
  containerId,
  inputs = NO_INPUTS,
  prompt,
  modelOptions = NO_OPTIONS,
  scope = "",
}: GeneratePlanInput) {
  const [acceptedCostFor, setAcceptedCostFor] = useState<string | null>(null)
  // An edge that cannot be read comes first: it names the wire to fix. Then
  // a family whose wiring or provider no endpoint can run, in the sentence
  // the endpoint choice wrote.
  const blockedReason = isBlocked(inputs)
    ? inputs.blocked
    : (descriptor?.family?.choice.message ?? null)

  /**
   * What `@venkz` means for *this* model.
   *
   * It runs in the renderer because the user must see the plan before they pay
   * for it — the reference read-out, the downgrade note and the run are all
   * this one computation. ⛔ It is pure and it submits nothing; main's guards
   * in `generations-submit.ts` are still the last word on every slot and every
   * asset it names.
   */
  const subjects = useMentionSubjects().data ?? NO_SUBJECTS
  const mentions = useMemo(
    () =>
      resolveMentions({
        prompt: prompt ?? draft.prompt,
        subjects,
        slots: descriptor?.referenceSlots ?? [],
        // The edges the user drew always win: they are an explicit gesture.
        occupied: countBySlot(isBlocked(inputs) ? [] : inputs.references),
      }),
    [descriptor, draft.prompt, inputs, prompt, subjects]
  )

  const request = useMemo(() => {
    if (!descriptor || isBlocked(inputs)) return null
    return buildGenerationRequest({
      descriptor,
      containerId,
      values: {
        // The *resolved* prompt is what is submitted and what the row records:
        // it is the text the provider was actually given. The raw `@venkz`
        // stays in the draft, which is what the user keeps editing.
        prompt: mentions.prompt,
        common: draft.common,
        advanced: draft.advanced,
        // Appended after the edge references, so the user's own wiring keeps
        // the earlier positions in every slot.
        references: groupReferences([
          ...inputs.references,
          ...mentions.references,
        ]),
      },
      // ⛔ Null on purpose: main mints the batch id, so the renderer cannot
      // claim two runs are siblings when the handler decided otherwise.
      batchId: null,
      // The prompt above has lost its `@handles`, so who this run was about
      // travels beside it — a scene's cast is read from this.
      mentionedContainerIds: mentionedContainerIds(mentions),
      // Only a family has an endpoint to choose; a concrete key's request
      // stays exactly what it was before families existed.
      providerOverride: descriptor.family
        ? (modelOptions.provider ?? null)
        : null,
    })
  }, [containerId, descriptor, draft, inputs, mentions, modelOptions.provider])

  const quoteParams = useMemo(
    () => (descriptor && request ? costParams(descriptor, request) : {}),
    [descriptor, request]
  )
  const cost = useCostEstimate(
    descriptor ? descriptor.key : null,
    quoteParams,
    modelOptions
  )

  const missing = useMemo(
    () =>
      descriptor && request ? missingRequirements(descriptor, request) : [],
    [descriptor, request]
  )

  /**
   * How many jobs N results costs, decided by the same `planBatch` main will
   * run — one prediction with the model's own count field, or N siblings. The
   * preview id is thrown away; only `runs` is read.
   */
  const plan = useMemo(
    () =>
      descriptor && request
        ? planBatch({
            request,
            count: draft.count,
            inputSchema: descriptor.inputSchema,
            batchId: "preview",
          })
        : null,
    [descriptor, draft.count, request]
  )

  const disabledReason =
    blockedReason ??
    (!draft.modelKey
      ? "Pick a model to generate with."
      : modelPending
        ? "Loading the model's parameters…"
        : !descriptor
          ? "This model's parameters could not be read."
          : !kinds.includes(descriptor.kind)
            ? "Choose a model that matches this node’s media type."
            : missing.length > 0
              ? `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} still needed.`
              : null)

  const costIdentity = JSON.stringify([
    scope,
    draft.modelKey,
    familyChoice(draft.modelKey ?? "", modelOptions),
    quoteParams,
    draft.count,
  ])
  const unknownCost = !cost.data || cost.data.confidence === "unknown"
  const acceptsCost = !unknownCost || acceptedCostFor === costIdentity
  const acceptUnknownCost = useCallback(
    (accept: boolean) => setAcceptedCostFor(accept ? costIdentity : null),
    [costIdentity]
  )

  const submission = useSubmitBatch()
  const canRun =
    disabledReason === null &&
    request !== null &&
    !submission.isPending &&
    !cost.isFetching &&
    acceptsCost

  /**
   * The total: the per-run quote times the number of results asked for. An
   * unknown rate stays unknown however many times it is multiplied — ⛔ never
   * `$0.00`.
   */
  const total: CostQuote | undefined =
    cost.data && cost.data.confidence !== "unknown"
      ? { ...cost.data, amount: cost.data.amount * draft.count }
      : cost.data

  const submit = submission.mutate
  const run = useCallback(
    (onSuccess?: (result: BatchSubmissionResult) => void) => {
      if (!request || !canRun) return
      const count = Math.max(1, Math.min(MAX_BATCH, draft.count))
      submit(
        // The quote is stamped as the user saw it, per run.
        {
          request: {
            ...request,
            ...quoteOf(cost.data),
            acceptUnknownCost: unknownCost && acceptsCost,
          },
          count,
        },
        { onSuccess }
      )
    },
    [acceptsCost, canRun, cost.data, draft.count, request, submit, unknownCost]
  )

  return {
    subjects,
    mentions,
    request,
    cost,
    total,
    plan,
    blockedReason,
    disabledReason,
    /** True while the price is unknown and a run needs the user's say-so. */
    unknownCost,
    /** Whether the user has accepted this exact composition's unknown price. */
    acceptedUnknownCost: acceptedCostFor === costIdentity,
    acceptUnknownCost,
    canRun,
    submission,
    run,
  }
}
