"use client"

/**
 * The creation bar: the one place a run is composed.
 *
 * It is persistent and it is quiet. The board is the hero of this window, so
 * the bar keeps to a single strip at the bottom — references above, the prompt
 * and the model on the main line, and the two disclosures below. Everything is
 * outline or ghost except Generate, which is the only thing here that spends
 * money and is therefore the only thing shouting.
 *
 * Price and commitment are read together: the cost sits immediately left of
 * Generate, set in the mono face because it is data, and it says "Cost
 * unknown" rather than a confident zero whenever OpenDirect cannot know.
 *
 * ⛔ Generate queues a row; the job runner in main is what submits it, and the
 * job list on the status strip is where it is watched and cancelled.
 */
import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  GitBranchIcon,
  Settings02Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type { CreationController } from "@/hooks/use-creation"
import { CommonFieldControl } from "@/lib/schema-form/widgets"

import { ModelPicker } from "@/components/models/model-picker"

import { AdvancedParams } from "./advanced-params"
import { CostBadge } from "./cost-badge"
import { ReferencePicker } from "./reference-picker"
import { ReferencesTray } from "./references-tray"

export interface CreationBarProps {
  creation: CreationController
}

/**
 * The quick ways to make a branch differ from its parent.
 *
 * Deliberately prompt text and nothing else. A preset that quietly changed a
 * parameter would be OpenDirect guessing at a run the user is about to pay
 * for, so each of these only appends words the user can see and edit.
 */
const BRANCH_PRESETS: { label: string; suffix: string }[] = [
  { label: "Slower camera", suffix: "slower camera move" },
  { label: "Different expression", suffix: "a different expression" },
  { label: "Different styling", suffix: "styled differently" },
]

/** Why Generate is off, in the words the tooltip uses. */
function blockedReason(creation: CreationController): string | null {
  if (!creation.modelKey) return "Pick a model to generate with."
  if (creation.isLoadingModel) return "Loading the model's parameters…"
  if (!creation.descriptor) return "This model's parameters could not be read."
  if (creation.missing.length > 0) {
    return `${creation.missing.join(" and ")} ${creation.missing.length === 1 ? "is" : "are"} still needed.`
  }
  return null
}

export function CreationBar({ creation }: CreationBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // A branch fills the bar and then hands the caret over: the prompt is the
  // one thing the user is expected to change.
  const { focusToken } = creation
  useEffect(() => {
    if (focusToken === 0) return
    const field = promptRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [focusToken])

  const split = creation.split
  const settings = split?.common.filter((field) => field.control !== "prompt")
  const advancedCount = split
    ? Object.keys(split.advanced.properties).length
    : 0
  const blocked = blockedReason(creation)

  return (
    <div
      data-testid="creation-bar"
      className="sticky bottom-0 z-20 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        {creation.notice ? (
          <p
            role="status"
            className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          >
            {creation.notice}
            <Button
              variant="ghost"
              size="sm"
              onClick={creation.dismissNotice}
              className="h-6"
            >
              Dismiss
            </Button>
          </p>
        ) : null}

        {creation.submitError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          >
            {creation.submitError.message}
          </p>
        ) : null}

        {creation.parentGenerationId ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs">
            <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
            <span className="text-muted-foreground">
              Branching from an earlier run
            </span>
            {BRANCH_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                className="h-6"
                onClick={() => creation.appendToPrompt(preset.suffix)}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6"
              onClick={creation.clearBranch}
            >
              Not a branch
            </Button>
          </div>
        ) : null}

        {split ? (
          <ReferencesTray
            slots={split.slots}
            selection={creation.references}
            assets={creation.knownAssets}
            onRemove={creation.removeReference}
            onBrowse={creation.browseSlot}
          />
        ) : null}

        <div className="flex items-end gap-2">
          <Textarea
            ref={promptRef}
            aria-label="Prompt"
            placeholder="Describe what you want…"
            rows={1}
            value={creation.prompt}
            onChange={(event) => creation.setPrompt(event.target.value)}
            className="max-h-32 min-h-9 flex-1 resize-y py-2"
          />

          <ModelPicker
            value={creation.modelKey}
            onChange={creation.setModelKey}
          />

          <CostBadge quote={creation.quote} pending={creation.isQuoting} />

          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex" data-testid="generate-wrapper" />
              }
            >
              <Button
                onClick={creation.submit}
                disabled={blocked !== null || creation.isSubmitting}
              >
                {creation.isSubmitting ? "Queueing…" : "Generate"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {blocked ??
                "Queues the run. Nothing is sent to a provider until the job runner exists."}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!settings || settings.length === 0}
                  className="text-muted-foreground"
                />
              }
            >
              <HugeiconsIcon icon={Settings02Icon} className="size-3.5" />
              Settings
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className={cn(
                  "size-3.5 transition-transform",
                  settingsOpen && "rotate-90"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-x-8 gap-y-1 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                {settings?.map((field) => (
                  <CommonFieldControl
                    key={field.field}
                    field={field}
                    value={creation.common[field.field]}
                    onChange={(value) =>
                      creation.setCommonValue(field.field, value)
                    }
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            variant="ghost"
            size="sm"
            disabled={!split}
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
      </div>

      {split && creation.descriptor ? (
        <AdvancedParams
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          modelName={creation.descriptor.name}
          schema={split.advanced}
          values={creation.advanced}
          onChange={creation.setAdvanced}
          request={creation.request}
        />
      ) : null}

      {creation.picker ? (
        <ReferencePicker
          key={creation.picker.slot.field}
          open
          slot={creation.picker.slot}
          capacity={creation.picker.capacity}
          assets={creation.picker.assets}
          initialSelection={creation.picker.initialSelection}
          sourceLabel={creation.picker.sourceLabel}
          onConfirm={creation.confirmPicker}
          onCancel={creation.cancelPicker}
        />
      ) : null}
    </div>
  )
}
