"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { useContainerTree } from "@/hooks/use-containers"
import { findContainer, placesToFile } from "@/lib/board/sidebar-tree"
import { filingContainerId, rememberFilingContainer } from "@/lib/canvas/filing"
import { requestCanvasFocus } from "@/lib/canvas/focus-request"

import { Canvas } from "@/components/canvas/canvas"

/**
 * The canvas route's body.
 *
 * `focus` frames that container's nodes and files new ones under it. Without
 * one, new nodes go under the container last visited (see `lib/canvas/filing`),
 * and the chip over the surface says which — and changes it — because a run
 * filed somewhere the user cannot see is a run they will not find again.
 */
export function CanvasScreen({ focus }: { focus: string | null }) {
  const tree = useContainerTree()
  const nodes = useMemo(() => tree.data ?? [], [tree.data])
  /** A choice made on the chip, which outranks the focus while it exists. */
  const [picked, setPicked] = useState<string | null>(null)

  const containerId = useMemo(
    () =>
      picked && findContainer(nodes, picked)
        ? picked
        : filingContainerId(nodes, focus),
    [nodes, focus, picked]
  )

  useEffect(() => {
    if (focus && containerId === focus) rememberFilingContainer(focus)
  }, [focus, containerId])

  // Held by the canvas until its nodes have loaded, then answered once.
  useEffect(() => {
    if (focus) requestCanvasFocus(focus)
  }, [focus])

  const options = useMemo(() => placesToFile(nodes), [nodes])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Canvas containerId={containerId} />
      {containerId ? (
        <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/90 py-1 pr-1 pl-3 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          <span id="canvas-filing">File new nodes under</span>
          <Select
            value={containerId}
            onValueChange={(next: string | null) => {
              if (!next) return
              rememberFilingContainer(next)
              setPicked(next)
            }}
          >
            <SelectTrigger
              size="sm"
              aria-labelledby="canvas-filing"
              className="h-7 text-foreground"
            >
              <SelectValue>
                {(value: unknown) =>
                  options.find((node) => node.id === value)?.name ?? "—"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.name}
                  <span className="text-muted-foreground">{node.kind}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
