"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import type { ContainerNodeDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"

import {
  useCreateContainer,
  useDeleteContainer,
  useRenameContainer,
} from "@/hooks/use-containers"
import type {
  ContainerDragData,
  ContainerDropData,
} from "@/lib/board/drop-target"

export interface ContainerTreeProps {
  nodes: ContainerNodeDto[]
  selectedId: string | null
  onSelect: (node: ContainerNodeDto) => void
  depth?: number
}

export interface DeleteContainerDialogProps {
  node: Pick<ContainerNodeDto, "id" | "name" | "children">
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The confirmation a container delete now has to pass.
 *
 * Deleting cascades to sub-containers and there is no undo for it — the canvas
 * history refuses non-canvas operations — so the only thing standing between a
 * mis-aimed right-click and a lost shelf is this dialog. The copy says what
 * survives, because the reassurance used to live in a code comment.
 */
export function DeleteContainerDialog({
  node,
  open,
  onOpenChange,
}: DeleteContainerDialogProps) {
  const deleteContainer = useDeleteContainer()
  const nested = node.children.length

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{node.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {nested > 0
              ? `This also deletes ${nested} container${nested === 1 ? "" : "s"} inside it. `
              : ""}
            Assets stay in the project; only the container and its
            sub-containers are removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteContainer.isPending}
            onClick={() =>
              deleteContainer.mutate(node.id, {
                onSuccess: () =>
                  toast.success(`Deleted “${node.name}”`, {
                    description: "Its assets are still in the project.",
                  }),
                onError: (error) =>
                  toast.error(`Could not delete “${node.name}”`, {
                    description: error.message,
                  }),
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface ContainerRowProps {
  node: ContainerNodeDto
  selectedId: string | null
  onSelect: (node: ContainerNodeDto) => void
  depth: number
}

/**
 * One row of the tree: a drop target, a selection, an inline rename field and
 * a right-click menu.
 *
 * The whole row — not just the label — is the droppable, because a drag is
 * aimed with a pointer and a 20px-tall strip is a cruel target.
 */
function ContainerRow({
  node,
  selectedId,
  onSelect,
  depth,
}: ContainerRowProps) {
  const [expanded, setExpanded] = useState(true)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const createContainer = useCreateContainer()
  const renameContainer = useRenameContainer()

  const dropData: ContainerDropData = {
    type: "container",
    containerId: node.id,
  }
  const { setNodeRef, isOver } = useDroppable({
    id: `container:${node.id}`,
    data: dropData,
  })

  /**
   * The label is also a drag *handle*, so a whole container can be carried to
   * the creation bar's reference tray. Only the label: the expand chevron and
   * the inline rename field have to keep working as themselves.
   */
  const dragData: ContainerDragData = {
    type: "container",
    containerId: node.id,
    name: node.name,
  }
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: `container-drag:${node.id}`, data: dragData })

  const hasChildren = node.children.length > 0

  const commitRename = () => {
    const name = draftName?.trim()
    setDraftName(null)
    if (name && name !== node.name) {
      renameContainer.mutate({ id: node.id, name })
    }
  }

  return (
    <SidebarMenuItem
      role="treeitem"
      aria-selected={selectedId === node.id}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <ContextMenu>
        <ContextMenuTrigger className="block w-full">
          <div
            ref={setNodeRef}
            data-testid="container-row"
            data-container-id={node.id}
            data-over={isOver || undefined}
            style={{ paddingInlineStart: depth * 12 }}
            className={cn(
              "flex items-center gap-0.5 rounded-md",
              isOver && "bg-primary/15 ring-1 ring-primary ring-inset"
            )}
          >
            <button
              type="button"
              aria-label={
                expanded ? `Collapse ${node.name}` : `Expand ${node.name}`
              }
              onClick={() => setExpanded((value) => !value)}
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground",
                !hasChildren && "pointer-events-none opacity-0"
              )}
            >
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className={cn(
                  "size-3.5 transition-transform",
                  expanded && "rotate-90"
                )}
              />
            </button>

            {draftName === null ? (
              <SidebarMenuButton
                ref={setDragRef}
                {...dragListeners}
                {...dragAttributes}
                className="flex-1"
                data-dragging={isDragging || undefined}
                isActive={selectedId === node.id}
                onClick={() => onSelect(node)}
                onDoubleClick={() => setDraftName(node.name)}
              >
                <HugeiconsIcon
                  icon={Folder01Icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{node.name}</span>
              </SidebarMenuButton>
            ) : (
              <input
                autoFocus
                aria-label={`Rename ${node.name}`}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename()
                  if (event.key === "Escape") setDraftName(null)
                }}
                className="h-8 flex-1 rounded-md bg-transparent px-2 text-sm ring-1 ring-ring outline-none"
              />
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            onClick={() =>
              createContainer.mutate({
                name: "Untitled",
                kind: "folder",
                parentId: node.id,
              })
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            New container inside
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setDraftName(node.name)}>
            <HugeiconsIcon icon={PencilEdit02Icon} className="size-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-4" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <DeleteContainerDialog
        node={node}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      />

      {hasChildren && expanded ? (
        <SidebarMenuSub
          role="group"
          className="mx-0 translate-x-0 border-none px-0"
        >
          {node.children.map((child) => (
            <ContainerRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  )
}

export function ContainerTree({
  nodes,
  selectedId,
  onSelect,
  depth = 0,
}: ContainerTreeProps) {
  return (
    <SidebarMenu role="tree">
      {nodes.map((node) => (
        <ContainerRow
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </SidebarMenu>
  )
}
