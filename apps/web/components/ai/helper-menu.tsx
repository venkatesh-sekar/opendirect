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
 * ⛔ Nothing here applies an answer. Each item starts a run whose result goes
 * to `<HelperResultDialog/>` for the user to accept.
 */
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SparklesIcon } from "@hugeicons/core-free-icons"
import {
  AI_HELPER_LABELS,
  type AiHelperId,
  type AiToolId,
  type AiTools,
} from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

export interface HelperMenuProps {
  /** The detection result; `undefined` while it is still being fetched. */
  tools: AiTools | undefined
  /** Which helpers this surface offers, in the order it offers them. */
  helpers: readonly AiHelperId[]
  onRun: (helper: AiHelperId, tool: AiToolId) => void
  disabled?: boolean
  className?: string
  label?: string
}

/** Every CLI that is actually installed, in menu order. */
export function installedTools(tools: AiTools | undefined): AiToolId[] {
  if (!tools) return []
  return (["claude", "codex"] as const).filter((id) => tools[id].available)
}

export function HelperMenu({
  tools,
  helpers,
  onRun,
  disabled,
  className,
  label = "AI helpers",
}: HelperMenuProps) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<AiToolId | null>(null)

  const available = installedTools(tools)
  const tool =
    (chosen && tools?.[chosen].available ? chosen : tools?.preferred) ?? null

  // The whole point: no CLI, no menu, no trace of one.
  if (!tool || helpers.length === 0) return null

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

      <PopoverContent align="end" className="w-60 p-1">
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

        <ul className="flex flex-col">
          {helpers.map((helper) => (
            <li key={helper}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  onRun(helper, tool)
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
