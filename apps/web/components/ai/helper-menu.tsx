"use client"

/**
 * The ✨ menu: the only way an AI helper is ever started.
 *
 * Its most important behaviour is the one you cannot see. When no local
 * `claude` or `codex` was detected, this renders **nothing** — not a disabled
 * button, not a tooltip offering to explain. AI in OpenDirect is explicit and
 * optional, and a greyed-out teaser for something the user never installed is
 * an advertisement, not an affordance.
 *
 * When both CLIs are present the menu opens on the preferred one (the
 * `preferredAiTool` setting) and lets the user switch for this run only.
 *
 * Above the helpers sit the two things a user may want to say about a run:
 * an optional direction in their own words ("more cinematic, keep the
 * outfit"), which main adds to the helper's built-in prompt, and the model
 * the CLI is started with — the saved `aiModels` setting unless changed here
 * for this session.
 *
 * A surface that hands it `images` also gets the image helpers (Explain /
 * Rethink image) and a row of thumbnails to pick which picture they look at;
 * the direction box is then where a free-form question about it goes.
 *
 * ⛔ Nothing here applies an answer. Each item starts a run whose result goes
 * to `<HelperResultDialog/>` for the user to accept.
 */
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SparklesIcon } from "@hugeicons/core-free-icons"
import {
  AI_HELPER_LABELS,
  AI_INSTRUCTIONS_MAX_LENGTH,
  isImageHelper,
  type AiHelperId,
  type AssetDto,
  type AiToolId,
  type AiTools,
} from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { useSettings } from "@/lib/settings"
import type { AiRunOptions } from "@/hooks/use-ai"

import { AiModelPicker } from "./model-picker"

export interface HelperMenuProps {
  /** The detection result; `undefined` while it is still being fetched. */
  tools: AiTools | undefined
  /** Which helpers this surface offers, in the order it offers them. */
  helpers: readonly AiHelperId[]
  /**
   * The images the image helpers (Explain / Rethink image) can look at — the
   * selected node's picture, its wired references. The image helpers are not
   * offered without one.
   */
  images?: readonly AssetDto[]
  /**
   * `options.model` is undefined until settings have loaded — main then
   * reads the saved model itself — and null for "the CLI's own default".
   * `image` is the one the user chose, passed for an image helper only.
   */
  onRun: (
    helper: AiHelperId,
    tool: AiToolId,
    options: AiRunOptions,
    image?: AssetDto
  ) => void
  disabled?: boolean
  className?: string
  label?: string
}

/** Every CLI that is actually installed, in menu order. */
export function installedTools(tools: AiTools | undefined): AiToolId[] {
  if (!tools) return []
  return (["claude", "codex"] as const).filter((id) => tools[id].available)
}

const NO_IMAGES: readonly AssetDto[] = []

export function HelperMenu({
  tools,
  helpers,
  images = NO_IMAGES,
  onRun,
  disabled,
  className,
  label = "AI helpers",
}: HelperMenuProps) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<AiToolId | null>(null)
  const [instructions, setInstructions] = useState("")
  const [imageId, setImageId] = useState<string | null>(null)
  /** A model picked here, per tool; absent means "the saved setting". */
  const [models, setModels] = useState<
    Partial<Record<AiToolId, string | null>>
  >({})
  const settings = useSettings()

  const available = installedTools(tools)
  const tool =
    (chosen && tools?.[chosen].available ? chosen : tools?.preferred) ?? null

  /** The image helpers need an image; the others are always on offer. */
  const offered = helpers.filter(
    (helper) => !isImageHelper(helper) || images.length > 0
  )
  const offersImages = offered.some(isImageHelper)
  const image = images.find((one) => one.id === imageId) ?? images[0]

  // The whole point: no CLI, no menu, no trace of one.
  if (!tool || offered.length === 0) return null

  const model: string | null | undefined =
    tool in models ? models[tool] : settings.data?.aiModels[tool]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            className={cn("size-9 text-muted-foreground", className)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <HugeiconsIcon icon={SparklesIcon} className="size-4" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="nokey w-72 p-1"
        // Typing a direction must not reach the canvas's own shortcuts through
        // React's tree; Escape still bubbles so the popover can close.
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation()
        }}
      >
        {available.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Which CLI answers"
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <span>Run with</span>
            {available.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === tool}
                onClick={() => setChosen(id)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono",
                  id === tool
                    ? "border-foreground/30 bg-muted text-foreground"
                    : "border-transparent"
                )}
              >
                {id}
              </button>
            ))}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Runs locally with <span className="font-mono">{tool}</span>
            {tools?.[tool].version ? ` ${tools[tool].version}` : ""}
          </p>
        )}

        {offersImages && image ? (
          <div
            role="radiogroup"
            aria-label="Which image"
            className="flex flex-wrap items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <span className="mr-1">Image</span>
            {images.map((one) => {
              const name = one.label ?? one.originalName ?? "Image"
              const src = one.thumbnailUrl ?? one.url
              return (
                <button
                  key={one.id}
                  type="button"
                  role="radio"
                  aria-checked={one.id === image.id}
                  aria-label={name}
                  title={name}
                  onClick={() => setImageId(one.id)}
                  className={cn(
                    "size-8 overflow-hidden rounded border bg-muted",
                    one.id === image.id
                      ? "border-foreground/60 ring-1 ring-foreground/30"
                      : "border-transparent opacity-70 hover:opacity-100"
                  )}
                >
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt=""
                      className="size-full object-cover"
                      draggable={false}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-b px-2 pt-1 pb-2">
          <Textarea
            aria-label="Direction for the helper"
            placeholder={
              offersImages
                ? "Optional direction or question, e.g. why does it feel cold?"
                : "Optional direction, e.g. more cinematic, keep the outfit"
            }
            value={instructions}
            maxLength={AI_INSTRUCTIONS_MAX_LENGTH}
            rows={2}
            className="min-h-14 resize-none text-xs md:text-xs"
            onChange={(event) => setInstructions(event.target.value)}
          />
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="flex h-8 shrink-0 items-center">Model</span>
            <AiModelPicker
              key={`${tool}:${settings.data ? "ready" : "loading"}`}
              tool={tool}
              value={model ?? null}
              commitOn="change"
              className="flex-1"
              label={`Model for ${tool}`}
              onChange={(next) =>
                setModels((current) => ({ ...current, [tool]: next }))
              }
            />
          </div>
        </div>

        <ul className="flex flex-col pt-1">
          {offered.map((helper) => (
            <li key={helper}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  const options = {
                    model,
                    instructions: instructions.trim() || null,
                  }
                  if (isImageHelper(helper) && image) {
                    onRun(helper, tool, options, image)
                  } else {
                    onRun(helper, tool, options)
                  }
                }}
              >
                <HugeiconsIcon icon={SparklesIcon} className="size-4" />
                {AI_HELPER_LABELS[helper]}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
