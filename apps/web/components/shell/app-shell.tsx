"use client"

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
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
import { useQueryClient } from "@tanstack/react-query"
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
import { useCreation } from "@/hooks/use-creation"
import { queryKeys } from "@/hooks/query-keys"
import { branchPrefill } from "@/lib/create/branch"
import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"
import { invoke, isBridgeAvailable } from "@/lib/ipc"
import { useSettings } from "@/lib/settings"

import { AssetPreview } from "@/components/board/asset-preview"
import { Board } from "@/components/board/board"
import { CreationBar } from "@/components/create/creation-bar"

import { ProjectLauncher } from "./project-launcher"
import { ProjectSidebar, type BoardSelection } from "./sidebar"
import { StatusBar } from "./status-bar"

/**
 * A card has to travel a few pixels before it counts as a drag, otherwise
 * every click on a tile would open and immediately cancel a drag.
 */
const DRAG_ACTIVATION_DISTANCE = 6

/**
 * Whether the Electron preload has put the IPC bridge on `window` — `null`
 * until we are allowed to look.
 *
 * The renderer is a static export: `index.html` is prerendered in Node, where
 * no preload has run, and that one file is then opened both by the Electron
 * window, where the bridge exists, and by a plain browser tab, where it does
 * not. Reading the bridge *during* render therefore makes the first client
 * render disagree with the prerendered HTML, and React answers a mismatch by
 * throwing the server's DOM away and rebuilding the tree — which also destroys
 * and recreates next-themes' blocking theme script, a script that only does its
 * job when the parser runs it.
 *
 * `useSyncExternalStore` is how React is told that this is a value the server
 * cannot know: it hands back the server snapshot for the prerender *and* for
 * hydration, then re-checks once hydration is done and re-renders with the real
 * answer. The bridge is injected before the bundle runs and never changes
 * afterwards, so there is nothing to subscribe to.
 */
const NO_BRIDGE_SUBSCRIPTION = () => () => {}
const BRIDGE_UNKNOWN = () => null

function useBridge(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    NO_BRIDGE_SUBSCRIPTION,
    isBridgeAvailable,
    BRIDGE_UNKNOWN
  )
}

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
  const router = useRouter()
  const bridge = useBridge()
  const project = useCurrentProject()
  const tree = useContainerTree(project.data != null)
  const dnd = useAssetDnd()
  const settings = useSettings()
  const [switching, setSwitching] = useState(false)
  const [chosen, setChosen] = useState<BoardSelection | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

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

  /**
   * The creation bar's own state. It is a hook rather than internal state
   * because the drag that fills its reference tray is resolved by the
   * `DndContext` below, which lives here, and because the board's selection is
   * what decides where a run's outputs land.
   */
  const creation = useCreation({
    containerId: selection?.containerId ?? null,
    defaultModelKey: settings.data?.defaultVideoModel ?? null,
  })

  /**
   * Branching needs the run's inputs as well as its row, so the detail query
   * is fetched (or read from cache) and handed to the pure mapper. The bar is
   * only *filled*: `useCreation` never submits on its own.
   */
  const client = useQueryClient()
  const branchFromGeneration = useCallback(
    (generationId: string) => {
      void client
        .fetchQuery({
          queryKey: queryKeys.generations.detail(generationId),
          queryFn: () => invoke("generations:get", { id: generationId }),
        })
        .then((detail) => creation.branchFrom(branchPrefill(detail)))
        .catch((error: unknown) =>
          // Silence here would look like a branch that simply did nothing.
          creation.notify(
            error instanceof Error
              ? `That run could not be loaded to branch from: ${error.message}`
              : "That run could not be loaded to branch from."
          )
        )
    },
    [client, creation]
  )

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

  const title =
    selection?.view === "generations"
      ? "Generations"
      : (selectedContainer?.name ?? project.data.name)

  return (
    <DndContext
      sensors={sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={(event) => {
        // Two independent readers of the same drop: the board mutation, and
        // the creation bar's reference tray. Each ignores what is not its own.
        dnd.onDragEnd(event)
        creation.onDragEnd(event)
      }}
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
                  onUseAsReference={creation.useAsReference}
                  onBranch={branchFromGeneration}
                  onUsePromptText={creation.appendToPrompt}
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
            The status strip: the only permanent sign that work is happening in
            the background, and the way into the job list.
          */}
          <StatusBar />

          {/*
            A `sticky bottom-0` sibling of the panel group, so the bar sits
            above the board's own scroll box rather than scrolling away with it.
          */}
          <CreationBar creation={creation} containerName={title} />
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
