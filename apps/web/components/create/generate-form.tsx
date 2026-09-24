"use client"

/**
 * A composition that is not a canvas node: prompt, model, the model's
 * parameters, the references its mentions will send, the price, and Generate.
 *
 * The canvas's prompt bar is the same run in a different shape — both are
 * `useGeneratePlan` underneath, so a character's page and the canvas cannot
 * disagree about what `@mira` sends or what it costs. What this form does not
 * have is the canvas: no edges, no per-node draft, no node to write back to.
 * Its draft is its own state, and closing the form is discarding it.
 *
 * References come from the prompt. `@mira` attaches the character's chosen
 * references, in order, for any model with an image input — the same rule the
 * canvas applies — so the read-out above the prompt is the plan, not a second
 * selection. They are edited on the character's page.
 *
 * ⛔ Generate is the only thing in this file that spends money, once per
 * click, and it is disabled while a submission is in flight, while the quote
 * is loading and while an unknown price has not been accepted.
 */
import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SlidersHorizontalIcon } from "@hugeicons/core-free-icons"
import type { ModelKind } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"

import { useGeneratePlan, type GenerateDraft } from "@/hooks/use-generate-plan"
import { useModel } from "@/hooks/use-models"
import { buildIconGrid, withoutIconGridFields } from "@/lib/canvas/icon-grid"
import { modelDefaults } from "@/lib/create/draft"
import type { MentionOutcome } from "@/lib/mentions/resolve"
import { formatCostQuote } from "@/lib/price"
import { splitSchema } from "@/lib/schema-form/split-schema"
import { useSettings } from "@/lib/settings"

import { MentionTextarea } from "@/components/canvas/mention-textarea"
import { MentionNotes } from "@/components/canvas/reference-tray"
import { SettingsPopover } from "@/components/canvas/settings-popover"
import { ModelPicker } from "@/components/models/model-picker"

import { AdvancedParams } from "./advanced-params"

/** Stable: the picker keeps it in a hotkey dependency list. */
const ANY_KIND: ModelKind[] = ["image", "video"]

/** The images the prompt's mentions will send, numbered as the model gets them. */
function sentImages(outcomes: readonly MentionOutcome[]) {
  const images: { assetId: string; url: string | null; handle: string }[] = []
  for (const outcome of outcomes) {
    if (outcome.kind !== "image") continue
    outcome.assetIds.forEach((assetId, index) =>
      images.push({
        assetId,
        url: outcome.thumbnailUrls[index] ?? null,
        handle: outcome.handle,
      })
    )
  }
  return images
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </span>
  )
}

export interface GenerateFormProps {
  /** Where the run's outputs are filed. */
  containerId: string
  /** The container's name, for the "Save to" line. */
  destination: string
  /** What the prompt starts as — `@mira ` on Mira's page. */
  initialPrompt: string
  /** Called once a run is queued, with nothing spent beyond it. */
  onSubmitted?: () => void
}

export function GenerateForm({
  containerId,
  destination,
  initialPrompt,
  onSubmitted,
}: GenerateFormProps) {
  const settings = useSettings()
  const [draft, setDraft] = useState<
    GenerateDraft & { seededFor: string | null }
  >({
    prompt: initialPrompt,
    modelKey: null,
    common: {},
    advanced: {},
    count: 1,
    seededFor: null,
  })
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // The saved default model until the user picks one — an image model first,
  // since a character's first run is usually a still.
  const fallbackModel =
    settings.data?.defaultImageModel ?? settings.data?.defaultVideoModel ?? null
  const modelKey = draft.modelKey ?? fallbackModel
  const composed = useMemo(() => ({ ...draft, modelKey }), [draft, modelKey])

  /**
   * The slot keys the prompt's `@mentions` fill, from the last render's
   * plan — as on the canvas's prompt bar. A family's endpoint (and price
   * tier) is chosen by what is filled, and main chooses it from the
   * references the run carries, so the descriptor and the quote are asked
   * for with them. The loop settles in one step: a family's slots are the
   * union of its endpoints', whatever is filled.
   */
  const [mentionSlots, setMentionSlots] = useState<readonly string[]>([])
  const modelOptions = useMemo(
    () => ({ provider: null, filled: [...mentionSlots] }),
    [mentionSlots]
  )

  const model = useModel(modelKey, modelOptions)
  const descriptor = model.data

  /**
   * A model change reseeds the parameters from *that* model's defaults and
   * leaves the prompt alone — the same rule as the canvas. Done while
   * rendering, React's pattern for state that follows a prop, so no frame
   * ever shows one model's parameters under another model's name.
   */
  if (descriptor && draft.seededFor !== descriptor.key) {
    setDraft({
      ...draft,
      ...modelDefaults(descriptor),
      seededFor: descriptor.key,
    })
  }

  const plan = useGeneratePlan({
    draft: composed,
    descriptor,
    // A family re-choosing its endpoint shows its last descriptor meanwhile;
    // a run must wait for the one that matches what is filled.
    modelPending:
      (model.isPending || model.isPlaceholderData) && modelKey !== null,
    kinds: ANY_KIND,
    containerId,
    modelOptions,
  })

  // Adjusting state to the plan during render: it only sets when the slots
  // differ, so it settles at once.
  const nextMentionSlots = useMemo(
    () =>
      [
        ...new Set(plan.mentions.references.map((one) => one.slotField)),
      ].sort(),
    [plan.mentions.references]
  )
  if (nextMentionSlots.join("\n") !== mentionSlots.join("\n")) {
    setMentionSlots(nextMentionSlots)
  }

  const grid = useMemo(
    () => (descriptor ? buildIconGrid(descriptor) : null),
    [descriptor]
  )
  const advancedSchema = useMemo(
    () =>
      descriptor && grid
        ? withoutIconGridFields(splitSchema(descriptor).advanced, grid)
        : null,
    [descriptor, grid]
  )
  const advancedCount = advancedSchema
    ? Object.keys(advancedSchema.properties).length
    : 0
  const images = sentImages(plan.mentions.outcomes)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>References</Label>
        {images.length > 0 ? (
          <ol className="flex flex-wrap gap-2">
            {images.map((image, index) => (
              <li
                key={`${image.assetId}-${index}`}
                data-testid="panel-reference"
                data-asset-id={image.assetId}
                className="relative h-16 w-13 overflow-hidden rounded-md bg-muted"
                title={`@${image.handle}`}
              >
                {image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : null}
                <span className="absolute top-1 left-1 rounded bg-background/80 px-1 text-[10px] font-medium">
                  {index + 1}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">
            {descriptor
              ? "Nothing is attached. A mention attaches its references when the model takes images."
              : "Choose a model to see what the prompt's mentions will attach."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Prompt</Label>
        <MentionTextarea
          aria-label="Prompt"
          placeholder="Describe what you want…"
          rows={5}
          value={draft.prompt}
          onChange={(prompt) => setDraft((current) => ({ ...current, prompt }))}
          subjects={plan.subjects}
          className="min-h-28 w-full resize-none py-2"
        />
        <MentionNotes mentions={plan.mentions.outcomes} />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Model</Label>
        <ModelPicker
          value={modelKey}
          onChange={(key) =>
            setDraft((current) => ({ ...current, modelKey: key }))
          }
          kinds={ANY_KIND}
          className="w-full"
          // The panel is not the only picker the window has had; the palette
          // chord belongs to the canvas.
          hotkeys={false}
          placeholder="Model"
        />
      </div>

      {grid || advancedSchema ? (
        <div className="flex flex-wrap items-center gap-2">
          {grid && grid.rows.length > 0 ? (
            <SettingsPopover
              grid={grid}
              values={draft.common}
              onChange={(field, value) =>
                setDraft((current) => ({
                  ...current,
                  common: { ...current.common, [field]: value },
                }))
              }
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!advancedSchema}
            onClick={() => setAdvancedOpen(true)}
            className="text-muted-foreground"
          >
            <HugeiconsIcon icon={SlidersHorizontalIcon} className="size-3.5" />
            Advanced
            {advancedCount > 0 ? (
              <span className="font-mono text-xs tabular-nums">
                {advancedCount}
              </span>
            ) : null}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t pt-4 text-xs">
        <span className="text-muted-foreground">Save to</span>
        <span className="truncate font-medium">{destination}</span>
      </div>

      {plan.unknownCost && descriptor && !plan.cost.isFetching ? (
        <label className="flex items-start gap-2 rounded-md border border-status-running/30 bg-status-running/5 p-2 text-xs">
          <input
            type="checkbox"
            checked={plan.acceptedUnknownCost}
            onChange={(event) => plan.acceptUnknownCost(event.target.checked)}
          />
          I understand pricing is unavailable for this model. This run may incur
          charges; the provider determines the final cost.
        </label>
      ) : null}

      <Button
        onClick={() => plan.run(() => onSubmitted?.())}
        disabled={!plan.canRun}
        className="w-full"
      >
        {plan.submission.isPending ? "Queueing…" : "Generate"}
        <span className="ml-auto font-mono text-xs tabular-nums opacity-70">
          {formatCostQuote(plan.total)}
        </span>
      </Button>

      {plan.disabledReason ? (
        <p className="text-xs text-muted-foreground">{plan.disabledReason}</p>
      ) : null}
      {plan.submission.error ? (
        <p role="alert" className="text-xs text-destructive">
          {plan.submission.error.message}
        </p>
      ) : null}

      {advancedSchema && descriptor ? (
        <AdvancedParams
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          modelName={descriptor.name}
          schema={advancedSchema}
          values={draft.advanced}
          onChange={(advanced) =>
            setDraft((current) => ({ ...current, advanced }))
          }
          request={plan.request}
        />
      ) : null}
    </div>
  )
}
