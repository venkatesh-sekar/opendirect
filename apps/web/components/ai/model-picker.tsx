"use client"

/**
 * Which model a local CLI is started with — the value of its own `--model`.
 *
 * Three kinds of choice, in one small select: the CLI's own default (no flag
 * at all, so whatever the user's `claude`/`codex` config says), a preset from
 * `AI_MODEL_PRESETS`, or a custom name typed into the field that appears under
 * "Custom…". A custom name is checked with the same `isValidAiModel` main uses
 * before it becomes an argv element, so the field can say "not valid" before
 * the run would fail.
 *
 * Shared by Settings (the saved per-tool default) and the ✨ menu (a one-run
 * override). Callers should key it by tool so a switch resets the draft.
 */
import { useId, useState } from "react"
import {
  AI_MODEL_MAX_LENGTH,
  AI_MODEL_PRESETS,
  isValidAiModel,
  type AiToolId,
} from "@opendirect/contract"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"

const DEFAULT = "__default__"
const CUSTOM = "__custom__"

/** True when `value` is one of the tool's presets. */
export function isPresetModel(tool: AiToolId, value: string | null): boolean {
  return (
    value !== null && AI_MODEL_PRESETS[tool].some((one) => one.value === value)
  )
}

/** The label for a model choice: "CLI default", a preset's name, or the id. */
export function aiModelLabel(tool: AiToolId, value: string | null): string {
  if (value === null) return "CLI default"
  return (
    AI_MODEL_PRESETS[tool].find((one) => one.value === value)?.label ?? value
  )
}

export interface AiModelPickerProps {
  tool: AiToolId
  /** Null is "the CLI's own default" — no `--model` flag is passed. */
  value: string | null
  onChange: (model: string | null) => void
  /**
   * When a typed custom name is reported: on every valid keystroke (a
   * one-run override, where nothing is saved) or on blur/Enter (Settings,
   * where each report is a write).
   */
  commitOn?: "change" | "blur"
  size?: "sm" | "default"
  disabled?: boolean
  className?: string
  /** Accessible name of the select. */
  label?: string
}

export function AiModelPicker({
  tool,
  value,
  onChange,
  commitOn = "blur",
  size = "sm",
  disabled,
  className,
  label = `${tool} model`,
}: AiModelPickerProps) {
  const customValue = value !== null && !isPresetModel(tool, value)
  /** "Custom…" was picked but no valid name has been reported yet. */
  const [customMode, setCustomMode] = useState(false)
  const [draft, setDraft] = useState(customValue ? (value ?? "") : "")
  const errorId = useId()

  const custom = customMode || customValue
  const trimmed = draft.trim()
  const invalid = trimmed.length > 0 && !isValidAiModel(trimmed)

  function commit(): void {
    if (trimmed && !invalid && trimmed !== value) onChange(trimmed)
  }

  const current = custom
    ? customValue
      ? `Custom · ${value}`
      : "Custom…"
    : aiModelLabel(tool, value)

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Select
        value={custom ? CUSTOM : (value ?? DEFAULT)}
        disabled={disabled}
        onValueChange={(next: string | null) => {
          if (next === null) return
          if (next === CUSTOM) {
            setCustomMode(true)
            return
          }
          setCustomMode(false)
          setDraft("")
          onChange(next === DEFAULT ? null : next)
        }}
      >
        <SelectTrigger
          size={size}
          aria-label={label}
          className="w-full min-w-0 text-xs"
        >
          <SelectValue className="min-w-0 truncate font-mono">
            {() => current}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>CLI default</SelectItem>
          <SelectSeparator />
          {AI_MODEL_PRESETS[tool].map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
              <span className="ml-auto font-mono text-muted-foreground">
                {preset.value}
              </span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom…</SelectItem>
        </SelectContent>
      </Select>

      {custom ? (
        <>
          <Input
            aria-label={`Custom ${tool} model`}
            placeholder={tool === "claude" ? "claude-opus-5-5" : "gpt-5.5"}
            value={draft}
            maxLength={AI_MODEL_MAX_LENGTH}
            disabled={disabled}
            autoFocus={customMode}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="h-8 font-mono text-xs"
            onChange={(event) => {
              const next = event.target.value
              setDraft(next)
              const clean = next.trim()
              if (commitOn === "change" && clean && isValidAiModel(clean)) {
                onChange(clean)
              }
            }}
            onBlur={commitOn === "blur" ? commit : undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter" && commitOn === "blur") {
                event.preventDefault()
                commit()
              }
            }}
          />
          {invalid ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              Use letters, digits and . _ - : / @ [ ] only.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
