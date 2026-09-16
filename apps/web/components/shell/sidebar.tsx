"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ContainerNodeDto, ProjectRefDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  Settings01Icon,
  UnfoldMoreIcon,
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useContainerTree, useCreateContainer } from "@/hooks/use-containers"
import { buildSidebarSections } from "@/lib/board/sidebar-tree"

import { ContainerTree } from "./container-tree"

export interface ProjectSidebarProps {
  project: ProjectRefDto
  /** The container the workspace is pointed at, or null for an empty project. */
  selectedContainerId: string | null
  onSelectContainer: (node: ContainerNodeDto) => void
  onSwitchProject: () => void
}

/**
 * The left rail: the project, then the three headings the product names.
 *
 * Headings are a view over `containers:tree`, not rows of their own — see
 * `lib/board/sidebar-tree.ts`. Creating from a heading creates a container of
 * that heading's kind at the top level, which is why the "+" is on the group
 * rather than only in a row's context menu.
 */
export function ProjectSidebar({
  project,
  selectedContainerId,
  onSelectContainer,
  onSwitchProject,
}: ProjectSidebarProps) {
  const pathname = usePathname()
  const tree = useContainerTree()
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

  // `trailingSlash: true` in the static export, so "/settings" arrives as
  // "/settings/" in the packaged app and without the slash in development.
  const onSettings = (pathname ?? "/").startsWith("/settings")

  return (
    <Sidebar collapsible="icon" className="border-r">
      {/*
        The project name *is* the project switcher, which nothing used to say:
        no icon, no label, only a hover colour. The chevron pair is the
        conventional "this opens a picker" glyph, and the accessible name says
        so outright — including when the rail is collapsed to icons and the
        name itself is clipped away.
      */}
      <SidebarHeader className="h-11 justify-center border-b px-3">
        <button
          type="button"
          onClick={onSwitchProject}
          title={project.path}
          aria-label={`Switch project — ${project.name}`}
          className="flex w-full items-center justify-between gap-2 rounded-md text-left text-sm font-medium hover:text-foreground/80"
        >
          <span className="truncate">{project.name}</span>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </button>
      </SidebarHeader>

      <SidebarContent>
        {tree.isPending ? (
          <SidebarGroup className="gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </SidebarGroup>
        ) : (
          sections.map((section) => (
            <SidebarGroup key={section.id}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupAction
                aria-label={`New ${section.childKind}`}
                onClick={() =>
                  createContainer.mutate(
                    {
                      name: `New ${section.childKind}`,
                      kind: section.childKind,
                      parentId: null,
                    },
                    { onSuccess: (created) => setAutoRenameId(created.id) }
                  )
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} />
              </SidebarGroupAction>
              <SidebarGroupContent>
                {section.nodes.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Nothing here yet.
                  </p>
                ) : (
                  <ContainerTree
                    nodes={section.nodes}
                    selectedId={selectedContainerId}
                    onSelect={onSelectContainer}
                    autoRenameId={autoRenameId}
                    onAutoRenameDone={() => setAutoRenameId(null)}
                  />
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
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
