"use client"

import { useMemo } from "react"
import Link from "next/link"
import type { ContainerNodeDto, ProjectRefDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Layers01Icon,
  PlusSignIcon,
  Settings01Icon,
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

export type BoardSelection =
  | { view: "board"; containerId: string }
  | { view: "generations"; containerId: string | null }

export interface ProjectSidebarProps {
  project: ProjectRefDto
  selection: BoardSelection | null
  onSelectContainer: (node: ContainerNodeDto) => void
  onSelectGenerations: () => void
  onSwitchProject: () => void
}

/**
 * The left rail: the project, then the four headings the product names.
 *
 * Headings are a view over `containers:tree`, not rows of their own — see
 * `lib/board/sidebar-tree.ts`. Creating from a heading creates a container of
 * that heading's kind at the top level, which is why the "+" is on the group
 * rather than only in a row's context menu.
 */
export function ProjectSidebar({
  project,
  selection,
  onSelectContainer,
  onSelectGenerations,
  onSwitchProject,
}: ProjectSidebarProps) {
  const tree = useContainerTree()
  const createContainer = useCreateContainer()
  const sections = useMemo(
    () => buildSidebarSections(tree.data ?? []),
    [tree.data]
  )

  const selectedContainerId =
    selection?.view === "board" ? selection.containerId : null

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="h-11 justify-center border-b px-3">
        <button
          type="button"
          onClick={onSwitchProject}
          title={project.path}
          className="flex w-full items-center gap-2 rounded-md text-left text-sm font-medium hover:text-foreground/80"
        >
          <span className="truncate">{project.name}</span>
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
              {section.virtual ? null : (
                <SidebarGroupAction
                  aria-label={`New ${section.childKind}`}
                  onClick={() =>
                    createContainer.mutate({
                      name: "Untitled",
                      kind: section.childKind,
                      parentId: null,
                    })
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} />
                </SidebarGroupAction>
              )}
              <SidebarGroupContent>
                {section.virtual ? (
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={selection?.view === "generations"}
                        onClick={onSelectGenerations}
                      >
                        <HugeiconsIcon
                          icon={Layers01Icon}
                          className="size-3.5 text-muted-foreground"
                        />
                        <span>Every run</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                ) : section.nodes.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    Nothing here yet.
                  </p>
                ) : (
                  <ContainerTree
                    nodes={section.nodes}
                    selectedId={selectedContainerId}
                    onSelect={onSelectContainer}
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
            <SidebarMenuButton render={<Link href="/settings" />}>
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
