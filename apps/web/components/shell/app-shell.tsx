"use client"

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { isBridgeAvailable, subscribe } from "@/lib/ipc"

import { useAssetDnd } from "@/hooks/use-asset-dnd"
import { useBridge } from "@/hooks/use-bridge"
import { useCurrentProject } from "@/hooks/use-containers"
import { isSettingsPath, rememberRoute, returnRoute } from "@/lib/shell/routes"

import { ProjectLauncher } from "./project-launcher"
import { ProjectSidebar } from "./sidebar"
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
 * Remembers every route but Settings, query string included, as the way back
 * out of Settings — `/container/?id=b` must come back as `?id=b` even though
 * `?id=a` had the same pathname, and whether Settings was reached by ⌘, the
 * menu or the sidebar's plain link.
 *
 * Its own component, under its own `Suspense`, because `useSearchParams`
 * suspends during the static export's prerender and must not take the rest of
 * the window with it.
 */
function RouteMemory() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    rememberRoute(pathname ?? "/", search ? `?${search}` : "")
  }, [pathname, search])
  return null
}

/**
 * The window: sidebar, the route's content, and the drag context that joins
 * them.
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
export function AppShell({ children }: { children?: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const onSettings = isSettingsPath(pathname)
  const bridge = useBridge()
  const project = useCurrentProject()
  const dnd = useAssetDnd()
  const [switching, setSwitching] = useState(false)

  const toSettings = useCallback(
    () => router.push(onSettings ? returnRoute() : "/settings"),
    [router, onSettings]
  )

  /**
   * ⌘, toggles Settings, the way it does in every other desktop app. It is
   * registered on the shell rather than the sidebar's link because it has to
   * work while the caret is in the prompt, which is where it usually is — and
   * because the shell now outlives the route, the same chord gets you back.
   *
   * In the packaged app this chord never reaches here: `CmdOrCtrl+,` is an
   * application-menu accelerator and the menu wins. That is why the menu item
   * sends `toggle: true` below — the two paths have to mean the same thing,
   * and this hotkey is what the browser dev path (`pnpm dev:web`, no menu)
   * actually uses.
   */
  useHotkeys(
    "mod+comma",
    (event) => {
      event.preventDefault()
      toSettings()
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [toSettings]
  )

  /**
   * The application menu's "Settings…" item. The menu lives in main and the
   * router lives here, so the item can only be a push — and it is subscribed
   * on the shell, which now outlives every route, so it works from anywhere.
   *
   * `toggle` is how ⌘, keeps one meaning across both worlds: main cannot know
   * which route is mounted, so it asks for a toggle and this decides. Without
   * it the menu accelerator would be a one-way trip into Settings while the
   * same chord in the browser toggled.
   */
  useEffect(() => {
    if (!isBridgeAvailable()) return
    return subscribe("shell:navigate", ({ path, toggle }) => {
      const current = pathname ?? "/"
      router.push(toggle && current.startsWith(path) ? returnRoute() : path)
    })
  }, [router, pathname])

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
    // Settings is the one screen that means something without a project open —
    // it is where the provider keys are, which is what a first-run user is
    // usually sent here for. It keeps its own way back (see the page).
    // The same column the inset gives it when a project *is* open, so the page
    // fills the window instead of collapsing to its content.
    if (onSettings)
      return <div className="flex min-h-svh flex-col">{children}</div>
    return (
      <ProjectLauncher
        onCancel={
          project.data && switching ? () => setSwitching(false) : undefined
        }
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <Suspense fallback={null}>
        <RouteMemory />
      </Suspense>
      <SidebarProvider>
        {/* The sidebar reads `?id=` to mark the open container's row, and
            `useSearchParams` wants a boundary for the static export. */}
        <Suspense fallback={null}>
          <ProjectSidebar
            project={project.data}
            onSwitchProject={() => setSwitching(true)}
          />
        </Suspense>
        <SidebarInset className="flex min-h-svh min-w-0 flex-col">
          {/*
            Whichever route is mounted — Home, a grid, the canvas, Settings —
            and every one of them keeps the sidebar, the status strip and ⌘,
            because those are rendered here, above the router.

            The canvas mounts inside this `DndContext` on purpose: it watches
            for the sidebar's asset drag and accepts it on its own droppable,
            turning the drop into a media node. ⛔ Nothing on this path spends
            money without a click on the prompt bar's Generate button.
          */}
          {children}

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
