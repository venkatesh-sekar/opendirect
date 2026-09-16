"use client"

/**
 * The three decisions worth a picture: quality, resolution, aspect ratio.
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import type {
  IconGrid,
  IconGridCell,
  IconGridRow,
} from "@/lib/canvas/icon-grid"
import { iconGridSummary } from "@/lib/canvas/icon-grid"

export interface SettingsPopoverProps {
  grid: IconGrid
  /** The node's draft params, keyed by the model's own field names. */
  values: Readonly<Record<string, unknown>>
  onChange: (field: string, value: string) => void
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
  onChange: (field: string, value: string) => void
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

export function SettingsPopover({
  grid,
  values,
  onChange,
  disabled,
  footer,
}: SettingsPopoverProps) {
  // No row means the model promotes none of these three. A chip that opened an
  // empty popover would be a promise of controls that do not exist — unless
  // the bar has handed something else down to it.
  if (grid.rows.length === 0 && !footer) return null

  const summary = iconGridSummary(grid, values)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="settings-chip"
            className="shrink-0"
          >
            <HugeiconsIcon icon={Settings02Icon} className="size-3.5" />
            <span className="truncate">{summary || "Settings"}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto min-w-64 gap-3">
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
