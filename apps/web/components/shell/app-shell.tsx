"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useHotkeys } from "react-hotkeys-hook"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import type { ContainerNodeDto } from "@opendirect/contract"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useAssetDnd } from "@/hooks/use-asset-dnd"
import { useBridge } from "@/hooks/use-bridge"
import { useContainerTree, useCurrentProject } from "@/hooks/use-containers"
import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"

import { Canvas } from "@/components/canvas/canvas"

import { ProjectLauncher } from "./project-launcher"
import { ProjectSidebar, type BoardSelection } from "./sidebar"
import { StatusBar } from "./status-bar"

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
 * The window: sidebar, canvas, and the drag context that joins them.
 *
 * The `DndContext` wraps both panes because a drag starts in one and ends in
 * the other — a sidebar asset dropped on the canvas becomes a media node, and
 * a drag that lands on a container row is a move. Splitting the context would
 * put the draggable and the droppable in different worlds.
 *
 * Everything below the shell is dumb about drag and drop: `useAssetDnd` owns
 * the container mutation and the canvas owns its own droppable; the rows and
 * tiles only declare themselves.
 */
export function AppShell() {
  const router = useRouter()
  const bridge = useBridge()
  const project = useCurrentProject()
  const tree = useContainerTree(project.data != null)
  const dnd = useAssetDnd()
  const [switching, setSwitching] = useState(false)
  const [chosen, setChosen] = useState<BoardSelection | null>(null)

  /**
   * ⌘, opens Settings, the way it does in every other desktop app. It is
   * registered on the shell rather than the sidebar's link because it has to
   * work while the caret is in the prompt, which is where it usually is.
   */
  useHotkeys(
    "mod+comma",
    (event) => {
      event.preventDefault()
      router.push("/settings")
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [router]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
    }),
    // Space picks a card up and puts it down; the arrow keys walk it to a
    // container. Enter is left to the card, which uses it to select.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space"],
      },
    })
  )

  const nodes = useMemo(() => tree.data ?? [], [tree.data])

  /**
   * Which container the workspace is pointed at. Derived rather than stored,
   * so the shell opens on the first container without an effect and falls back
   * on its own the moment the selected container is deleted underneath it.
   */
  const selection = useMemo<BoardSelection | null>(() => {
    if (chosen?.view === "generations") return chosen
    if (chosen && findContainer(nodes, chosen.containerId)) return chosen
    const first = firstSelectableContainer(nodes)
    return first ? { view: "board", containerId: first.id } : null
  }, [chosen, nodes])

  // Before hydration is over we cannot know which of the two windows this is,
  // and the skeleton is the one answer that is honest either way.
  if (bridge === null) return <ShellSkeleton />

  if (!bridge) {
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

  /**
   * The container the canvas imports into and reads runs from — the same
   * expression the board was handed, so selecting a container in the sidebar
   * still switches the workspace and nothing else about the tree changes.
   */
  const containerId =
    selection?.view === "generations"
      ? selection.containerId
      : (selectedContainer?.id ?? null)

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

        <SidebarInset className="flex min-h-svh min-w-0 flex-col">
          {/*
            The canvas is the workspace. It mounts inside this `DndContext` on
            purpose: it watches for the sidebar's asset drag and accepts it on
            its own droppable, turning the drop into a media node.

            It also carries its own prompt bar, anchored under the selected
            generate node, which is why there is no creation bar down here any
            more. ⛔ Nothing on this path spends money without a click on that
            bar's Generate button.
          */}
          <Canvas containerId={containerId} />

          {/*
            The status strip: the only permanent sign that work is happening in
            the background, and the way into the job list.
          */}
          <StatusBar />
        </SidebarInset>
      </SidebarProvider>

      <DragOverlay dropAnimation={null}>
        {dnd.activeDrag ? (
          <div className="flex flex-col gap-0.5 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground shadow-lg">
            <span>
              {dnd.moveIntent ? "Move to container" : "Add to container"}
            </span>
            <span className="text-primary-foreground/70">
              {dnd.moveIntent
                ? "Release Shift to keep a copy here"
                : "Hold Shift to move"}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
