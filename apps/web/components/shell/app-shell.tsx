"use client"

import { useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { ContainerNodeDto } from "@opendirect/contract"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useAsset } from "@/hooks/use-assets"
import { useAssetDnd } from "@/hooks/use-asset-dnd"
import { useContainerTree, useCurrentProject } from "@/hooks/use-containers"
import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"
import { isBridgeAvailable } from "@/lib/ipc"

import { AssetPreview } from "@/components/board/asset-preview"
import { Board } from "@/components/board/board"

import { ProjectLauncher } from "./project-launcher"
import { ProjectSidebar, type BoardSelection } from "./sidebar"

/**
 * A card has to travel a few pixels before it counts as a drag, otherwise
 * every click on a tile would open and immediately cancel a drag.
 */
const DRAG_ACTIVATION_DISTANCE = 6

function ShellSkeleton() {
  return (
    <div className="flex min-h-svh">
      <div className="w-64 shrink-0 border-r p-3">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex-1 p-4">
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  )
}

/**
 * The window: sidebar, board, and the drag context that joins them.
 *
 * The `DndContext` wraps both panes because a drag starts on the board and
 * ends in the sidebar; splitting it would put the draggable and the droppable
 * in different worlds. Everything below the shell is dumb about drag and drop —
 * `useAssetDnd` owns the mutation, the cards and rows only declare themselves.
 */
export function AppShell() {
  const project = useCurrentProject()
  const tree = useContainerTree(project.data != null)
  const dnd = useAssetDnd()
  const [switching, setSwitching] = useState(false)
  const [chosen, setChosen] = useState<BoardSelection | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
    })
  )

  const nodes = useMemo(() => tree.data ?? [], [tree.data])
  const preview = useAsset(selectedAssetId)

  /**
   * What the board is actually showing. Derived rather than stored, so the
   * board opens on the first container without an effect and falls back on its
   * own the moment the selected container is deleted underneath it.
   */
  const selection = useMemo<BoardSelection | null>(() => {
    if (chosen?.view === "generations") return chosen
    if (chosen && findContainer(nodes, chosen.containerId)) return chosen
    const first = firstSelectableContainer(nodes)
    return first ? { view: "board", containerId: first.id } : null
  }, [chosen, nodes])

  if (!isBridgeAvailable()) {
    return (
      <main className="flex min-h-svh items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          OpenDirect runs in its desktop window. Start it with{" "}
          <code className="font-mono">pnpm dev:desktop</code>.
        </p>
      </main>
    )
  }

  if (project.isPending) return <ShellSkeleton />
  if (!project.data || switching) {
    return (
      <ProjectLauncher
        onCancel={
          project.data && switching ? () => setSwitching(false) : undefined
        }
      />
    )
  }

  const selectedContainer: ContainerNodeDto | null =
    selection?.view === "board"
      ? findContainer(nodes, selection.containerId)
      : null

  const title =
    selection?.view === "generations"
      ? "Generations"
      : (selectedContainer?.name ?? project.data.name)

  return (
    <DndContext
      sensors={sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <SidebarProvider>
        <ProjectSidebar
          project={project.data}
          selection={selection}
          onSelectContainer={(node) =>
            setChosen({ view: "board", containerId: node.id })
          }
          onSelectGenerations={() =>
            setChosen({
              view: "generations",
              containerId: selectedContainer?.id ?? null,
            })
          }
          onSwitchProject={() => setSwitching(true)}
        />

        <SidebarInset className="min-h-svh">
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            <ResizablePanel minSize="40%">
              <div className="flex h-full min-h-0 flex-col">
                <Board
                  containerId={
                    selection?.view === "generations"
                      ? selection.containerId
                      : (selectedContainer?.id ?? null)
                  }
                  title={title}
                  view={
                    selection?.view === "generations" ? "generations" : "all"
                  }
                  selectedAssetId={selectedAssetId}
                  onSelectAsset={(asset) =>
                    setSelectedAssetId((current) =>
                      current === asset.id ? null : asset.id
                    )
                  }
                />
              </div>
            </ResizablePanel>

            {preview.data ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="28%" minSize="18%" maxSize="50%">
                  <AssetPreview
                    asset={preview.data}
                    onClose={() => setSelectedAssetId(null)}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

          {/*
            The creation bar (Task 15) mounts here — a `sticky bottom-0`
            sibling of the panel group, so it sits above the board's own
            scroll box rather than scrolling away with it.
          */}
        </SidebarInset>
      </SidebarProvider>

      <DragOverlay dropAnimation={null}>
        {dnd.activeDrag ? (
          <div className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-lg">
            Move to a container
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
