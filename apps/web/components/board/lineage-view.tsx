"use client"

/**
 * A run's branch history, as a rail.
 *
 * The one piece of this app that is genuinely a picture: branching is the
 * workflow, and "what did this come from, and what came out of it" is not a
 * question a flat list answers. Each run is a dot on a hairline; depth is
 * indentation, so a variant sits under the take it was made from, and the run
 * the panel is open on is the only filled dot on the rail.
 *
 * No arrows and no numbers: this is a tree, not a sequence, and an edge that
 * is already drawn by the indent does not need a glyph as well.
 *
 * The shape comes from `buildLineageTree`, which is where the rules — every
 * run once, an orphan still shown — are asserted.
 */
import type { CSSProperties } from "react"
import type { GenerationDto, Lineage } from "@opendirect/contract"
import { cn } from "@workspace/ui/lib/utils"

import { buildLineageTree } from "@/lib/board/lineage-tree"
import { formatUsd } from "@/lib/price"

/** How far one generation of nesting moves a row, in pixels. */
const INDENT = 18

export interface LineageViewProps {
  lineage: Lineage
  /** Opens another run's details from inside this one. */
  onSelect?: (generation: GenerationDto) => void
}

function summary(generation: GenerationDto): string {
  const cost =
    generation.actualCostUsd ?? generation.estimatedCostUsd ?? null
  const parts = [
    generation.modelSlug,
    cost === null
      ? null
      : `${generation.actualCostUsd === null ? "~" : ""}${formatUsd(cost)}`,
  ]
  return parts.filter(Boolean).join(" · ")
}

export function LineageView({ lineage, onSelect }: LineageViewProps) {
  const tree = buildLineageTree(lineage)
  const alone = tree.nodes.length === 1

  return (
    <div className="flex flex-col gap-3">
      <ol data-testid="lineage" className="flex flex-col">
        {tree.nodes.map((node) => {
          const { generation, current } = node
          const row = (
            <>
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full border",
                  current
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/50 bg-background"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm">
                    {generation.prompt ?? "No prompt"}
                  </span>
                  {current ? (
                    <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                      This run
                    </span>
                  ) : null}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {summary(generation)}
                </span>
              </span>
            </>
          )

          return (
            <li
              key={generation.id}
              data-testid="lineage-node"
              data-generation-id={generation.id}
              data-parent-id={node.parentId ?? undefined}
              data-depth={node.depth}
              aria-current={current ? "true" : undefined}
              style={
                {
                  paddingLeft: node.depth * INDENT,
                  "--rail": `${Math.max(0, node.depth - 1) * INDENT + 4}px`,
                } as CSSProperties
              }
              className={cn(
                "relative py-1",
                // The rail: a hairline down the left of every nested row, which
                // is what makes the indent read as descent rather than as
                // decoration.
                node.depth > 0 &&
                  "before:absolute before:top-0 before:bottom-0 before:left-[var(--rail)] before:w-px before:bg-border"
              )}
            >
              {onSelect && !current ? (
                <button
                  type="button"
                  onClick={() => onSelect(generation)}
                  className="flex w-full items-start gap-2 rounded-sm px-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row}
                </button>
              ) : (
                <span className="flex w-full items-start gap-2 px-1">
                  {row}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {alone ? (
        <p className="text-xs text-muted-foreground">
          The only run in its branch. Branching from it will show its variants
          here.
        </p>
      ) : null}
    </div>
  )
}
