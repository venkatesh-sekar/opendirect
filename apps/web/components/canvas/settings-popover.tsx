"use client"

/**
 * The decisions a run is described by: how long, and the three worth a
 * picture — quality, resolution, aspect ratio.
 *
 * Duration comes first, from `durationSpec`: a handful of lengths are cells
 * like any other row, a longer list (Wan 3's 2–30 s) is a select, and a range
 * too wide to list is a number input. Whatever the control, the value written
 * is the one the schema declares — `10` for an integer, `"10s"` for a string
 * enum that spells it so.
 *
 * Every cell in here is a value the model's own schema lists. `buildIconGrid`
 * is what decides that — a row exists only because the schema declares the
 * field, and its cells are exactly the enum values in exactly schema order.
 * Nothing is padded to make a grid look even and nothing is renamed beyond
 * title-casing a value that is plainly a word, because the string on the cell
 * is the string the provider will receive.
 *
 * An aspect-ratio cell draws the ratio it parsed at the real proportions, so
 * `9:16` is a tall box and `21:9` is a wide one. A value that is not a ratio
 * at all — `auto`, `match_input_image` — draws no box, because there is
 * nothing honest to draw.
 *
 * ⛔ Nothing here submits anything. Choosing a cell writes one field into the
 * draft params of a node that has not been run.
 */
import type { ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"

import type {
  IconGrid,
  IconGridCell,
  IconGridRow,
} from "@/lib/canvas/icon-grid"
import { iconGridSummary } from "@/lib/canvas/icon-grid"
import {
  coerceDuration,
  currentDuration,
  durationInSeconds,
  formatDuration,
  type DurationSpec,
} from "@/lib/schema-form/duration"

/** Up to this many lengths are cells; more are a select. */
const DURATION_CELLS = 6

export interface SettingsPopoverProps {
  grid: IconGrid
  /** The model's length control, when it has one. */
  duration?: DurationSpec | null
  /** The node's draft params, keyed by the model's own field names. */
  values: Readonly<Record<string, unknown>>
  /** One field, set to a value of the type the model's schema declares. */
  onChange: (field: string, value: unknown) => void
  disabled?: boolean
  /**
   * Controls that belong in the prompt bar but do not fit in it.
   *
   * At narrow widths the bar hands its count stepper and cost badge down here
   * rather than wrapping them onto a line of their own — the bar is anchored
   * to a node, so growing taller pushes Run off the viewport just as growing
   * wider does.
   */
  footer?: ReactNode
  /**
   * The chip as its icon alone, named by its summary. For the narrowest bar,
   * where the summary's words would push Run off the card.
   */
  compact?: boolean
  /** Extra classes for the chip, e.g. `nokey` on a canvas. */
  className?: string
}

/** The longest side of an aspect-ratio glyph, in pixels. */
const RATIO_BOX = 18

/**
 * A box at the cell's real proportions. The size is data — it *is* the value
 * being chosen — so it is an inline dimension; every colour is a token.
 */
function RatioBox({ cell }: { cell: IconGridCell }) {
  const ratio = cell.ratio
  if (!ratio) return null
  const long = Math.max(ratio.w, ratio.h)
  return (
    <span
      aria-hidden
      data-testid="ratio-box"
      className="block rounded-[2px] border border-current"
      style={{
        width: `${(ratio.w / long) * RATIO_BOX}px`,
        height: `${(ratio.h / long) * RATIO_BOX}px`,
      }}
    />
  )
}

function Cell({
  cell,
  selected,
  onSelect,
}: {
  cell: IconGridCell
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid="icon-grid-cell"
      data-value={cell.value}
      onClick={onSelect}
      className={cn(
        "flex min-w-16 flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
      )}
    >
      {cell.ratio ? (
        <span className="flex h-5 items-center justify-center">
          <RatioBox cell={cell} />
        </span>
      ) : cell.icon ? (
        <HugeiconsIcon
          icon={cell.icon as Parameters<typeof HugeiconsIcon>[0]["icon"]}
          className="size-4"
        />
      ) : (
        <span className="h-4" />
      )}
      <span>{cell.label}</span>
    </button>
  )
}

function Row({
  row,
  values,
  onChange,
}: {
  row: IconGridRow
  values: Readonly<Record<string, unknown>>
  onChange: (field: string, value: unknown) => void
}) {
  // The schema's own default stands in until the user chooses; a model that
  // states none shows nothing selected rather than a guess.
  const raw = values[row.field]
  const chosen = typeof raw === "string" ? raw : row.default

  return (
    <div
      role="radiogroup"
      aria-label={row.label}
      data-testid="icon-grid-row"
      data-kind={row.kind}
      data-field={row.field}
      className="flex flex-col gap-1.5"
    >
      <span className="text-xs text-muted-foreground">{row.label}</span>
      <div className="flex flex-wrap gap-1.5">
        {row.cells.map((cell) => (
          <Cell
            key={cell.value}
            cell={cell}
            selected={cell.value === chosen}
            onSelect={() => onChange(row.field, cell.value)}
          />
        ))}
      </div>
    </div>
  )
}

/** What the length control is set to, as the chip's summary reads it. */
function durationSummary(
  spec: DurationSpec | null | undefined,
  values: Readonly<Record<string, unknown>>
): string {
  if (!spec) return ""
  const chosen = currentDuration(spec, values)
  return chosen === null ? "" : formatDuration(chosen, spec.unit)
}

/**
 * The length control. A model that states no default (every OpenRouter video
 * model) starts unset — the provider then picks — and says so, rather than
 * showing a length nobody chose.
 */
function DurationRow({
  spec,
  values,
  onChange,
}: {
  spec: DurationSpec
  values: Readonly<Record<string, unknown>>
  onChange: (field: string, value: unknown) => void
}) {
  const chosen = currentDuration(spec, values)
  const set = (raw: unknown) => {
    const next = coerceDuration(spec, raw)
    if (next !== null) onChange(spec.field, next)
  }
  const seconds =
    spec.unit === "frames" ? durationInSeconds(spec, chosen, values) : null
  const unset = "Model default"

  let control: ReactNode
  if (spec.choices && spec.choices.length <= DURATION_CELLS) {
    control = (
      <div
        role="radiogroup"
        aria-label={spec.label}
        className="flex flex-wrap gap-1.5"
      >
        {spec.choices.map((choice) => {
          const selected = chosen !== null && choice.value === chosen
          return (
            <button
              key={String(choice.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid="duration-cell"
              data-value={String(choice.value)}
              onClick={() => onChange(spec.field, choice.value)}
              className={cn(
                "min-w-12 rounded-md border px-2 py-1.5 text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
    )
  } else if (spec.choices) {
    const labels = new Map(
      spec.choices.map((choice) => [String(choice.value), choice.label])
    )
    control = (
      <Select
        value={chosen === null ? null : String(chosen)}
        onValueChange={(next: string | null) => {
          if (next !== null) set(next)
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={spec.label}
          data-testid="duration-select"
          className="w-full text-xs"
        >
          <SelectValue placeholder={unset}>
            {(value: string | null) =>
              value === null ? unset : (labels.get(value) ?? value)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {spec.choices.map((choice) => (
            <SelectItem key={String(choice.value)} value={String(choice.value)}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else {
    // A range too wide to list. Committed on blur or Enter, so a half-typed
    // number is never clamped under the user's fingers.
    const range = spec.range
    control = (
      <Input
        // A new model (or a choice made elsewhere) re-reads the value.
        key={`${spec.field}:${String(chosen)}`}
        type="number"
        inputMode="decimal"
        aria-label={spec.label}
        data-testid="duration-input"
        defaultValue={chosen === null ? "" : String(chosen)}
        placeholder={unset}
        min={range?.min ?? undefined}
        max={range?.max ?? undefined}
        step={range?.integer ? 1 : "any"}
        className="h-8 text-xs"
        onBlur={(event) => set(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
    )
  }

  return (
    <div
      data-testid="duration-row"
      data-field={spec.field}
      className="flex flex-col gap-1.5"
    >
      <span className="text-xs text-muted-foreground">
        {spec.label}
        {spec.unit === "frames" ? " (frames)" : null}
      </span>
      {control}
      {seconds !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          ≈ {Math.round(seconds * 10) / 10}s of video
        </span>
      ) : null}
      {chosen === null ? (
        <span className="text-xs text-muted-foreground">
          Not set — the provider picks the length.
        </span>
      ) : null}
    </div>
  )
}

export function SettingsPopover({
  grid,
  duration,
  values,
  onChange,
  disabled,
  footer,
  compact = false,
  className,
}: SettingsPopoverProps) {
  // No row means the model promotes none of these. A chip that opened an
  // empty popover would be a promise of controls that do not exist — unless
  // the bar has handed something else down to it.
  if (grid.rows.length === 0 && !duration && !footer) return null

  const summary = [
    durationSummary(duration, values),
    iconGridSummary(grid, values),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="settings-chip"
            aria-label={
              compact
                ? summary
                  ? `Settings: ${summary}`
                  : "Settings"
                : undefined
            }
            title={compact ? summary || "Settings" : undefined}
            // Stated, not measured: the summary changes with the model and a
            // chip that resizes moves every control beside it.
            className={cn(
              compact
                ? "size-8 shrink-0 justify-center px-0"
                : "w-40 shrink-0 justify-start",
              className
            )}
          >
            <HugeiconsIcon icon={Settings02Icon} className="size-3.5" />
            {compact ? null : (
              <span className="truncate">{summary || "Settings"}</span>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 gap-3">
        {duration ? (
          <DurationRow spec={duration} values={values} onChange={onChange} />
        ) : null}
        {grid.rows.map((row) => (
          <Row key={row.field} row={row} values={values} onChange={onChange} />
        ))}
        {footer ? (
          <div
            data-testid="settings-popover-footer"
            className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0"
          >
            {footer}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
