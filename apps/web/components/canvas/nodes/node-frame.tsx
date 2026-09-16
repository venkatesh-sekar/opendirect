"use client"

/**
 * The chrome every node on the canvas wears.
 *
 * One place for the three things that are the same whatever is inside: the
 * handles an edge is drawn from, the ring that says a node is selected, and
 * the "+" on each side that extends the graph in that direction.
 *
 * The handles follow the data model rather than the layout. A Text or Media
 * node has an output handle only, because nothing can be fed *into* a note or
 * an imported file; the two generate kinds have both. That is the same rule
 * `edges-to-inputs.ts` reads the graph with, spelled once here so an edge can
 * never be drawn into a node that has no use for one.
 *
 * ⛔ A "+" adds a node and an edge. It never runs anything: the node it
 * creates is empty, and an edge is a statement about the next run.
 */
import { useState, type ReactNode } from "react"
import { Handle, Position } from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Image01Icon,
  PlusSignIcon,
  TextIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import type { CanvasNodeDto, CanvasNodeType } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useCanvasSurface } from "../canvas-context"

/** The two kinds that take input, and therefore the two with a left handle. */
export function isGenerateNode(type: CanvasNodeType): boolean {
  return type === "image_gen" || type === "video_gen"
}

const SPAWN_CHOICES: {
  type: CanvasNodeType
  label: string
  icon: typeof TextIcon
}[] = [
  { type: "text", label: "Text", icon: TextIcon },
  { type: "image_gen", label: "Image gen", icon: Image01Icon },
  { type: "video_gen", label: "Video gen", icon: Video01Icon },
]

/**
 * The "+" on the right: one press, one image generate node, connected.
 *
 * No chooser, because the answer is nearly always "another image from this",
 * and the node's type is the one thing on a canvas that is trivial to change
 * by deleting it and pressing the other "+".
 */
function SpawnRight({ node }: { node: CanvasNodeDto }) {
  const surface = useCanvasSurface()
  if (!surface) return null
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label="Add a connected image generate node"
      className="nodrag nopan absolute top-1/2 -right-9 size-6 -translate-y-1/2 rounded-full opacity-0 shadow-sm transition-opacity group-hover/node:opacity-100 focus-visible:opacity-100"
      onClick={() => surface.spawn(node, "right", "image_gen")}
    >
      <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
    </Button>
  )
}

/**
 * The "+" on the left: a three-item popover, because what feeds a run is a
 * real choice — a note, a picture, or another run.
 */
function SpawnLeft({ node }: { node: CanvasNodeDto }) {
  const surface = useCanvasSurface()
  const [open, setOpen] = useState(false)
  if (!surface) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Add a connected input node"
            className="nodrag nopan absolute top-1/2 -left-9 size-6 -translate-y-1/2 rounded-full opacity-0 shadow-sm transition-opacity group-hover/node:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
          />
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="left" align="center" className="w-40 p-1">
        {SPAWN_CHOICES.map((choice) => (
          <Button
            key={choice.type}
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false)
              surface.spawn(node, "left", choice.type)
            }}
          >
            <HugeiconsIcon icon={choice.icon} className="size-4" />
            {choice.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export interface NodeFrameProps {
  node: CanvasNodeDto
  selected: boolean
  /** What the node says it is, top left. */
  title: ReactNode
  /** Controls in the header, right-aligned. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Body classes, so a sticky can colour itself and a frame cannot. */
  bodyClassName?: string
}

export function NodeFrame({
  node,
  selected,
  title,
  actions,
  children,
  className,
  bodyClassName,
}: NodeFrameProps) {
  const takesInput = isGenerateNode(node.type)

  return (
    <div
      className={cn(
        "group/node relative flex h-full w-full flex-col overflow-visible rounded-lg border bg-card text-card-foreground shadow-sm",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        className
      )}
      data-testid={`canvas-node-${node.id}`}
      data-node-type={node.type}
    >
      {takesInput ? (
        <>
          <Handle
            type="target"
            position={Position.Left}
            className="!size-2.5 !border-2"
          />
          <SpawnLeft node={node} />
        </>
      ) : null}

      <header className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="truncate font-medium text-muted-foreground">
          {title}
        </span>
        {actions ? (
          <span className="nodrag nopan ml-auto flex items-center gap-1">
            {actions}
          </span>
        ) : null}
      </header>

      <div className={cn("min-h-0 flex-1 overflow-hidden", bodyClassName)}>
        {children}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2"
      />
      <SpawnRight node={node} />
    </div>
  )
}
