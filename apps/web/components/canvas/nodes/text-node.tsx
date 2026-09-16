"use client"

/**
 * A coloured sticky.
 *
 * The simplest node there is, and the only one whose content the user types.
 * Its text is prepended to the prompt of everything it feeds — that is the
 * whole of what a text edge means (`edges-to-inputs.ts`) — so the body is a
 * plain textarea and nothing more.
 *
 * Two small rules:
 *
 * - **Saved on blur, not on every keystroke.** A note is edited in bursts and
 *   a write per character would be a write per frame, which is the one thing
 *   `use-canvas.ts` debounces positions to avoid.
 * - **The palette is tokens.** Every swatch is a `--chart-*` token that
 *   already flips with the theme, so a note written in the light theme is
 *   still legible in the dark one. No literal colour appears here.
 */
import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { PaintBoardIcon } from "@hugeicons/core-free-icons"
import type { CanvasNodeDto } from "@opendirect/contract"
import type { NodeProps } from "@xyflow/react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useUpdateCanvasNode } from "@/hooks/use-canvas"

import { NodeFrame } from "./node-frame"
import type { CanvasFlowNode } from "./types"

export interface NoteColor {
  /** What is stored in `canvas_nodes.color`. */
  name: string
  label: string
  /** Literal so Tailwind's scanner can see it. */
  className: string
}

/**
 * The fixed palette. Five plus the default, which is deliberately short: a
 * sticky's colour is a grouping cue, and a hundred of them group nothing.
 */
export const NOTE_COLORS: readonly NoteColor[] = [
  { name: "default", label: "Default", className: "bg-card" },
  { name: "chart-1", label: "Chart 1", className: "bg-chart-1/30" },
  { name: "chart-2", label: "Chart 2", className: "bg-chart-2/30" },
  { name: "chart-3", label: "Chart 3", className: "bg-chart-3/30" },
  { name: "chart-4", label: "Chart 4", className: "bg-chart-4/30" },
  { name: "chart-5", label: "Chart 5", className: "bg-chart-5/30" },
]

export function noteColor(name: string | null): NoteColor {
  return NOTE_COLORS.find((color) => color.name === name) ?? NOTE_COLORS[0]!
}

export function TextNodeBody({ node }: { node: CanvasNodeDto }) {
  const update = useUpdateCanvasNode()
  const [draft, setDraft] = useState(node.text ?? "")
  // The row is the source of truth; a change that arrives from anywhere else —
  // an undo, another window — has to land in the box the user is not in.
  const committed = useRef(node.text ?? "")
  useEffect(() => {
    const next = node.text ?? ""
    if (next === committed.current) return
    committed.current = next
    setDraft(next)
  }, [node.text])

  const color = noteColor(node.color)

  const commit = () => {
    const next = draft
    if (next === committed.current) return
    committed.current = next
    update.mutate({ id: node.id, patch: { text: next } })
  }

  return (
    <div className={cn("flex h-full w-full flex-col", color.className)}>
      <textarea
        aria-label="Note text"
        value={draft}
        placeholder="A note. Its text is added to the prompt of whatever it feeds."
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="nodrag nowheel h-full w-full resize-none bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** The swatch row, in the frame's header. */
export function TextNodeColors({ node }: { node: CanvasNodeDto }) {
  const update = useUpdateCanvasNode()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label="Note colour"
          />
        }
      >
        <HugeiconsIcon icon={PaintBoardIcon} className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto gap-1 p-1">
        {NOTE_COLORS.map((color) => (
          <button
            key={color.name}
            type="button"
            aria-label={color.label}
            aria-pressed={noteColor(node.color).name === color.name}
            onClick={() => {
              setOpen(false)
              update.mutate({ id: node.id, patch: { color: color.name } })
            }}
            className={cn(
              "size-5 rounded-full border",
              color.className,
              noteColor(node.color).name === color.name && "ring-2 ring-ring"
            )}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function TextNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.node
  return (
    <NodeFrame
      node={node}
      selected={selected === true}
      title="Note"
      actions={<TextNodeColors node={node} />}
      bodyClassName="overflow-hidden"
    >
      <TextNodeBody node={node} />
    </NodeFrame>
  )
}
