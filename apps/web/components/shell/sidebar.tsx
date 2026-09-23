"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { ContainerNodeDto, ProjectRefDto } from "@opendirect/contract"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  CanvasIcon,
  Film02Icon,
  Home01Icon,
  PlusSignIcon,
  Search01Icon,
  Settings01Icon,
  SparklesIcon,
  UnfoldMoreIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useContainerTree, useCreateContainer } from "@/hooks/use-containers"
import { useProjectGenerations } from "@/hooks/use-generations"
import { isJobActive, useJobs } from "@/hooks/use-jobs"
import { buildSidebarSections } from "@/lib/board/sidebar-tree"
import { formatUsd } from "@/lib/price"
import {
  canvasHref,
  containerHref,
  isOnRoute,
  isSettingsPath,
} from "@/lib/shell/routes"

import { ContainerTree } from "./container-tree"

export interface ProjectSidebarProps {
  project: ProjectRefDto
  onSwitchProject: () => void
}

/** "Neon Monsoon" → "NM": the project's tile when there is no picture for it. */
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("")
  return letters || "·"
}

interface NavLinkProps {
  href: string
  label: string
  icon: IconSvgElement
  active: boolean
  count?: number | null
  /** Makes room for the row's "+" on hover, which sits where the count is. */
  hasAction?: boolean
}

function NavLink({
  href,
  label,
  icon,
  active,
  count,
  hasAction,
}: NavLinkProps) {
  return (
    <SidebarMenuButton isActive={active} render={<Link href={href} />}>
      <HugeiconsIcon icon={icon} className="size-3.5 text-muted-foreground" />
      <span>{label}</span>
      {count != null ? (
        <span
          className={cn(
            "ml-auto text-[11px] text-muted-foreground tabular-nums",
            hasAction &&
              "transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0"
          )}
        >
          {count}
        </span>
      ) : null}
    </SidebarMenuButton>
  )
}

/**
 * "2 generating · $0.84", with a bar.
 *
 * The one ambient sign in the rail that money is being spent right now. It
 * only reads the job list; it never starts, resumes or retries anything. The
 * bar is the mean of the progress the providers report, and an indeterminate
 * pulse when none of them reports any — neither Replicate nor OpenRouter does
 * today, and an invented percentage would be worse than none.
 */
function GeneratingCard() {
  const jobs = useJobs()
  const active = useMemo(
    () => (jobs.data ?? []).filter(isJobActive),
    [jobs.data]
  )
  if (active.length === 0) return null

  const cost = active.reduce(
    (sum, job) => sum + (job.generation.estimatedCostUsd ?? 0),
    0
  )
  const known = active
    .map((job) => job.progress)
    .filter((value): value is number => value !== null)
  const progress =
    known.length > 0
      ? known.reduce((sum, value) => sum + value, 0) / known.length
      : null

  return (
    <div
      role="status"
      aria-label="Generating"
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-status-running" />
        <span className="font-medium">{active.length} generating</span>
        {cost > 0 ? (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {formatUsd(cost)}
          </span>
        ) : null}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-status-running",
            progress === null && "w-full animate-pulse opacity-40"
          )}
          style={
            progress === null
              ? undefined
              : { width: `${Math.round(progress * 100)}%` }
          }
        />
      </div>
    </div>
  )
}

/**
 * The left rail: the project, a search field, the places in the project, its
 * folders, what is generating and Settings.
 *
 * Characters and scenes are places now — each has a grid, and a row goes to
 * its container's page — so their rows sit under their nav entries rather than
 * under headings of their own. They stay rows, not only a count, because a row
 * is a drop target: dragging an output onto "Mira" still files it with her.
 *
 * Creating from a "+" creates a container of that kind at the top level, and
 * opens the new row straight into its rename field.
 */
export function ProjectSidebar({
  project,
  onSwitchProject,
}: ProjectSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const tree = useContainerTree()
  const generations = useProjectGenerations({ limit: 1 })
  const createContainer = useCreateContainer()
  /**
   * The container the "+" just made, waiting to be named.
   *
   * Creation used to leave an anonymous "Untitled" behind, and three of those
   * are three handles nobody would type. So the "+" creates *and* opens the
   * rename on the new row; the handle follows the name in main.
   */
  const [autoRenameId, setAutoRenameId] = useState<string | null>(null)
  const sections = useMemo(
    () => buildSidebarSections(tree.data ?? []),
    [tree.data]
  )
  const section = (id: "characters" | "scenes" | "assets") =>
    sections.find((entry) => entry.id === id)!

  const onSettings = isSettingsPath(pathname)

  const create = (kind: "character" | "scene" | "folder") =>
    createContainer.mutate(
      { name: `New ${kind}`, kind, parentId: null },
      { onSuccess: (created) => setAutoRenameId(created.id) }
    )

  const rows = (nodes: ContainerNodeDto[]) =>
    nodes.length === 0 ? null : (
      <ContainerTree
        nodes={nodes}
        selectedId={null}
        onSelect={(node) => router.push(containerHref(node.id))}
        autoRenameId={autoRenameId}
        onAutoRenameDone={() => setAutoRenameId(null)}
        depth={1}
      />
    )

  const characters = section("characters")
  const scenes = section("scenes")
  const folders = section("assets")

  return (
    <Sidebar collapsible="icon" className="border-r">
      {/*
        The project name *is* the project switcher, which nothing used to say:
        no icon, no label, only a hover colour. The chevron pair is the
        conventional "this opens a picker" glyph, and the accessible name says
        so outright — including when the rail is collapsed to icons and the
        name itself is clipped away.
      */}
      <SidebarHeader className="gap-3 px-2 pt-3 pb-2">
        <button
          type="button"
          onClick={onSwitchProject}
          title={project.path}
          aria-label={`Switch project — ${project.name}`}
          className="flex w-full items-center gap-2.5 rounded-md p-1 text-left hover:bg-sidebar-accent"
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-status-running/15 text-[11px] font-semibold text-status-running"
          >
            {initials(project.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{project.name}</span>
            <span className="text-[11px] text-muted-foreground">Project</span>
          </span>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
          />
        </button>

        {/*
          Visual only in v1 — it answers nothing yet, so it is not a text field
          a keyboard user could land in and type into for no result. Wiring it
          to ⌘K is its own piece of work.
        */}
        <div
          aria-hidden
          className="flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
        >
          <HugeiconsIcon icon={Search01Icon} className="size-3.5" />
          <span className="flex-1">Search or @mention</span>
          <kbd className="font-mono text-[11px]">⌘K</kbd>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="Project">
            <SidebarMenu>
              <SidebarMenuItem>
                <NavLink
                  href="/"
                  label="Home"
                  icon={Home01Icon}
                  active={isOnRoute(pathname, "/")}
                />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink
                  href="/characters/"
                  label="Characters"
                  icon={UserGroupIcon}
                  active={isOnRoute(pathname, "/characters/")}
                  count={tree.data ? characters.nodes.length : null}
                  hasAction
                />
                <SidebarMenuAction
                  showOnHover
                  aria-label="New character"
                  onClick={() => create("character")}
                >
                  <HugeiconsIcon icon={PlusSignIcon} />
                </SidebarMenuAction>
                {rows(characters.nodes)}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink
                  href="/scenes/"
                  label="Scenes"
                  icon={Film02Icon}
                  active={isOnRoute(pathname, "/scenes/")}
                  count={tree.data ? scenes.nodes.length : null}
                  hasAction
                />
                <SidebarMenuAction
                  showOnHover
                  aria-label="New scene"
                  onClick={() => create("scene")}
                >
                  <HugeiconsIcon icon={PlusSignIcon} />
                </SidebarMenuAction>
                {rows(scenes.nodes)}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink
                  href="/generations/"
                  label="Generations"
                  icon={SparklesIcon}
                  active={isOnRoute(pathname, "/generations/")}
                  count={generations.data?.total ?? null}
                />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <NavLink
                  href={canvasHref()}
                  label="Canvas"
                  icon={CanvasIcon}
                  active={isOnRoute(pathname, "/canvas/")}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroup>

        <SidebarGroup role="group" aria-labelledby="sidebar-folders">
          <SidebarGroupLabel id="sidebar-folders">Folders</SidebarGroupLabel>
          <SidebarGroupAction
            aria-label="New folder"
            onClick={() => create("folder")}
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </SidebarGroupAction>
          <SidebarGroupContent>
            {tree.isPending ? (
              <div className="flex flex-col gap-2 px-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : folders.nodes.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No folders yet.
              </p>
            ) : (
              <ContainerTree
                nodes={folders.nodes}
                selectedId={null}
                onSelect={(node) => router.push(containerHref(node.id))}
                autoRenameId={autoRenameId}
                onAutoRenameDone={() => setAutoRenameId(null)}
              />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t">
        <GeneratingCard />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={onSettings}
              render={<Link href="/settings" />}
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                className="size-3.5 text-muted-foreground"
              />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
