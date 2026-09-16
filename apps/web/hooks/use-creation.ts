"use client"

/**
 * The creation bar's state: which model, what prompt, which parameters, which
 * references — and the drop handling that fills them.
 *
 * It lives in a hook rather than in the bar because the drag that fills the
 * reference tray starts on the board and is resolved by the shell's single
 * `DndContext`; the shell needs `onDragEnd`, the bar needs everything else.
 * Same division as `useAssetDnd`.
 *
 * Resolving a drop is asynchronous: dnd-kit hands over an asset id or a
 * container id, and the tray needs the assets themselves to draw chips and to
 * know their media kind. Both come from the queries the rest of the app
 * already uses, fetched through the shared client so a board that is already
 * loaded costs nothing.
 *
 * ⛔ Nothing here submits. `submit` calls `generations:submit`, which writes a
 * `queued` row and stops — see `apps/desktop/src/main/generations-submit.ts`.
 */
import { useCallback, useMemo, useState } from "react"
import type { DragEndEvent } from "@dnd-kit/core"
import { useQueryClient } from "@tanstack/react-query"
import type {
  AssetDto,
  AssetPage,
  CostQuote,
  GenerationRequest,
  ModelDescriptor,
  ReferenceSlot,
} from "@opendirect/contract"

import { isAssetDragData, isContainerDragData } from "@/lib/board/drop-target"
import { isReferencesDropData } from "@/components/create/references-tray"
import {
  buildGenerationRequest,
  costParams,
  missingRequirements,
} from "@/lib/create/request"
import {
  planReferenceDrop,
  slotCapacity,
  type IncomingReference,
} from "@/lib/create/references"
import { invoke } from "@/lib/ipc"
import {
  schemaDefaults,
  splitSchema,
  type SchemaSplit,
} from "@/lib/schema-form/split-schema"

import { queryKeys } from "./query-keys"
import { useCostEstimate, useSubmitGeneration } from "./use-generations"
import { useModel } from "./use-models"

/** How many assets a container may offer the picker in one go. */
const PICKER_PAGE_SIZE = 500

export interface PickerState {
  slot: ReferenceSlot
  capacity: number | null
  /** Everything on offer, already resolved. */
  assets: AssetDto[]
  initialSelection: string[]
  sourceLabel: string | null
}

export interface CreationController {
  modelKey: string | null
  setModelKey: (key: string) => void
  descriptor: ModelDescriptor | undefined
  isLoadingModel: boolean
  split: SchemaSplit | null

  prompt: string
  setPrompt: (value: string) => void
  common: Record<string, unknown>
  setCommonValue: (field: string, value: unknown) => void
  advanced: Record<string, unknown>
  setAdvanced: (values: Record<string, unknown>) => void

  references: Record<string, string[]>
  knownAssets: ReadonlyMap<string, AssetDto>
  removeReference: (slotField: string, assetId: string) => void

  picker: PickerState | null
  browseSlot: (slotField: string) => void
  confirmPicker: (assetIds: string[]) => void
  cancelPicker: () => void

  /** Why the last drop did nothing, when it did nothing. */
  notice: string | null
  dismissNotice: () => void

  request: GenerationRequest | null
  missing: string[]
  quote: CostQuote | undefined
  isQuoting: boolean

  submit: () => void
  isSubmitting: boolean
  submitError: Error | null

  onDragEnd: (event: DragEndEvent) => void
}

export interface UseCreationOptions {
  /** The board the outputs land on, and the source for the `+` picker. */
  containerId: string | null
  /** Seeds the model on first render, e.g. from the user's saved default. */
  defaultModelKey?: string | null
}

export function useCreation(options: UseCreationOptions): CreationController {
  const client = useQueryClient()
  const [chosenModel, setChosenModel] = useState<string | null>(null)
  const modelKey = chosenModel ?? options.defaultModelKey ?? null

  const model = useModel(modelKey)
  const descriptor = model.data

  const [prompt, setPrompt] = useState("")
  const [common, setCommon] = useState<Record<string, unknown>>({})
  const [advanced, setAdvanced] = useState<Record<string, unknown>>({})
  const [references, setReferences] = useState<Record<string, string[]>>({})
  const [known, setKnown] = useState<Map<string, AssetDto>>(new Map())
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const split = useMemo(
    () => (descriptor ? splitSchema(descriptor) : null),
    [descriptor]
  )

  /**
   * A model change resets the parameters to that model's own defaults and
   * drops references whose slot no longer exists. Carrying `duration: 30` over
   * to a model whose maximum is 12 would be a quiet invalid request; the
   * prompt, which is the user's own work, is deliberately kept.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (descriptor && seededFor !== descriptor.key) {
    setSeededFor(descriptor.key)
    const defaults = schemaDefaults(descriptor)
    const fresh = splitSchema(descriptor)
    const commonFields = new Set(fresh.common.map((field) => field.field))
    const slotFields = new Set(fresh.slots.map((slot) => slot.field))

    const nextCommon: Record<string, unknown> = {}
    const nextAdvanced: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(defaults)) {
      if (slotFields.has(field)) continue
      if (commonFields.has(field)) nextCommon[field] = value
      else nextAdvanced[field] = value
    }
    setCommon(nextCommon)
    setAdvanced(nextAdvanced)
    const kept: Record<string, string[]> = {}
    for (const [field, ids] of Object.entries(references)) {
      if (slotFields.has(field)) kept[field] = ids
    }
    setReferences(kept)
    setPicker(null)
  }

  const remember = useCallback((assets: readonly AssetDto[]) => {
    if (assets.length === 0) return
    setKnown((current) => {
      const next = new Map(current)
      for (const asset of assets) next.set(asset.id, asset)
      return next
    })
  }, [])

  const fetchAsset = useCallback(
    (id: string) =>
      client.fetchQuery({
        queryKey: queryKeys.assets.detail(id),
        queryFn: () => invoke("assets:get", { id }),
      }),
    [client]
  )

  const fetchContainerAssets = useCallback(
    (containerId: string) =>
      client.fetchQuery<AssetPage>({
        queryKey: queryKeys.assets.byContainer(containerId, {
          limit: PICKER_PAGE_SIZE,
        }),
        queryFn: () =>
          invoke("assets:list", { containerId, limit: PICKER_PAGE_SIZE }),
      }),
    [client]
  )

  const setCommonValue = useCallback((field: string, value: unknown) => {
    setCommon((current) => ({ ...current, [field]: value }))
  }, [])

  const removeReference = useCallback(
    (slotField: string, assetId: string) => {
      setReferences({
        ...references,
        [slotField]: (references[slotField] ?? []).filter(
          (id) => id !== assetId
        ),
      })
    },
    [references]
  )

  /** Applies a plan, opening the picker when the drop is over the slot's limit. */
  const applyPlan = useCallback(
    (
      slots: readonly ReferenceSlot[],
      incoming: IncomingReference[],
      assets: AssetDto[],
      sourceLabel: string | null,
      slotField?: string
    ) => {
      const plan = planReferenceDrop({
        slots,
        current: references,
        incoming,
        sourceLabel,
        slotField,
      })

      if (plan.outcome === "unsupported") {
        setNotice(
          slots.length === 0
            ? "This model takes no reference assets."
            : "This model has no reference slot that accepts those assets."
        )
        return
      }

      if (plan.outcome === "choose") {
        const slot = slots.find(
          (candidate) => candidate.field === plan.slotField
        )
        if (!slot) return
        const byId = new Map(assets.map((asset) => [asset.id, asset]))
        setPicker({
          slot,
          capacity: plan.capacity,
          assets: plan.candidateIds
            .map((id) => byId.get(id))
            .filter((asset): asset is AssetDto => asset !== undefined),
          initialSelection: plan.preselectedIds,
          sourceLabel: plan.sourceLabel,
        })
        return
      }

      setReferences({ ...references, [plan.slotField]: plan.assetIds })
    },
    [references]
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!isReferencesDropData(event.over?.data.current)) return
      const slots = descriptor?.referenceSlots ?? []
      const active = event.active.data.current

      const resolve = async (): Promise<{
        assets: AssetDto[]
        sourceLabel: string | null
      } | null> => {
        if (isAssetDragData(active)) {
          return {
            assets: [await fetchAsset(active.assetId)],
            sourceLabel: null,
          }
        }
        if (isContainerDragData(active)) {
          const page = await fetchContainerAssets(active.containerId)
          return { assets: page.items, sourceLabel: active.name }
        }
        return null
      }

      void resolve()
        .then((resolved) => {
          if (!resolved) return
          if (resolved.assets.length === 0) {
            setNotice("That container has no assets to use as references.")
            return
          }
          remember(resolved.assets)
          applyPlan(
            slots,
            resolved.assets.map((asset) => ({
              assetId: asset.id,
              kind: asset.kind,
            })),
            resolved.assets,
            resolved.sourceLabel
          )
        })
        .catch((error: unknown) => {
          setNotice(
            error instanceof Error
              ? error.message
              : "Those references could not be read."
          )
        })
    },
    [applyPlan, descriptor, fetchAsset, fetchContainerAssets, remember]
  )

  /** The `+` on a slot: pick explicitly from whatever the board is showing. */
  const browseSlot = useCallback(
    (slotField: string) => {
      const slot = descriptor?.referenceSlots.find((s) => s.field === slotField)
      if (!slot) return
      if (!options.containerId) {
        setNotice("Open a container to choose references from it.")
        return
      }
      void fetchContainerAssets(options.containerId)
        .then((page) => {
          const usable = page.items.filter(
            (asset) => asset.kind !== "text" && asset.kind !== "prompt"
          )
          remember(usable)
          setPicker({
            slot,
            capacity: slotCapacity(slot),
            assets: usable,
            initialSelection: references[slotField] ?? [],
            sourceLabel: null,
          })
        })
        .catch(() => setNotice("That container could not be read."))
    },
    [
      descriptor,
      fetchContainerAssets,
      options.containerId,
      references,
      remember,
    ]
  )

  const confirmPicker = useCallback(
    (assetIds: string[]) => {
      if (picker) {
        setReferences({ ...references, [picker.slot.field]: assetIds })
      }
      setPicker(null)
    },
    [picker, references]
  )

  const cancelPicker = useCallback(() => setPicker(null), [])

  const request = useMemo(
    () =>
      descriptor
        ? buildGenerationRequest({
            descriptor,
            containerId: options.containerId,
            values: { prompt, common, advanced, references },
          })
        : null,
    [advanced, common, descriptor, options.containerId, prompt, references]
  )

  const quoteParams = useMemo(
    () => (descriptor && request ? costParams(descriptor, request) : {}),
    [descriptor, request]
  )
  const cost = useCostEstimate(descriptor ? descriptor.key : null, quoteParams)

  const missing = useMemo(
    () =>
      descriptor && request ? missingRequirements(descriptor, request) : [],
    [descriptor, request]
  )

  const submission = useSubmitGeneration()

  const submit = useCallback(() => {
    if (!descriptor || !request || missing.length > 0) return
    submission.mutate(
      // The quote is stamped at the moment of submission, so the row records
      // the number the user was actually looking at.
      { ...request, ...quoteOf(cost.data) },
      {
        onSuccess: () => {
          // The prompt is the one thing worth keeping: iterating on wording is
          // the whole workflow, and retyping settings between takes is not.
          setPrompt("")
        },
      }
    )
  }, [cost.data, descriptor, missing.length, request, submission])

  return {
    modelKey,
    setModelKey: setChosenModel,
    descriptor,
    isLoadingModel: model.isPending && modelKey !== null,
    split,

    prompt,
    setPrompt,
    common,
    setCommonValue,
    advanced,
    setAdvanced,

    references,
    knownAssets: known,
    removeReference,

    picker,
    browseSlot,
    confirmPicker,
    cancelPicker,

    notice,
    dismissNotice: () => setNotice(null),

    request,
    missing,
    quote: cost.data,
    isQuoting: cost.isFetching,

    submit,
    isSubmitting: submission.isPending,
    submitError: submission.error,

    onDragEnd,
  }
}

/** The quote, as the request records it: no amount when it is unknown. */
function quoteOf(quote: CostQuote | undefined) {
  return {
    estimatedCostUsd:
      quote && quote.confidence !== "unknown" ? quote.amount : null,
    costConfidence: quote ? quote.confidence : null,
  }
}
