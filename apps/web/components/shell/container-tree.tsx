"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import type { ContainerNodeDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  Delete02Icon,
  Folder01Icon,
  Note01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Tag01Icon,
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
import { queryKeys } from "@/hooks/query-keys"
import { findContainer } from "@/lib/board/sidebar-tree"
import type {
  ContainerDragData,
  ContainerDropData,
} from "@/lib/board/drop-target"

import {
  ContainerDetailsDialog,
  type ContainerDetailsField,
} from "./container-details-dialog"

export interface ContainerTreeProps {
  nodes: ContainerNodeDto[]
  selectedId: string | null
  onSelect: (node: ContainerNodeDto) => void
  /**
   * The container that was *just* created and has not been named yet: its row
   * opens straight into the rename field. Null once the name is settled.
   */
  autoRenameId?: string | null
  /** Called when that rename is committed, cancelled or abandoned. */
  onAutoRenameDone?: () => void
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
  const client = useQueryClient()
  // A sidebar row has its scene's shots taken out, but they go with it. The
  // tree the sidebar was drawn from is already cached, so it is read, never
  // fetched: nothing may reach main before the answer is yes.
  const shots =
    findContainer(
      client.getQueryData<ContainerNodeDto[]>(queryKeys.containers.tree) ?? [],
      node.id
    )?.children.filter((child) => child.kind === "shot").length ?? 0
  const nested = node.children.filter((child) => child.kind !== "shot").length
  const also = [
    nested > 0
      ? `${nested} container${nested === 1 ? "" : "s"} inside it`
      : null,
    shots > 0
      ? `its ${shots} shot${shots === 1 ? "" : "s"} (their runs stay on Generations)`
      : null,
  ].filter(Boolean)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{node.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {also.length > 0 ? `This also deletes ${also.join(" and ")}. ` : ""}
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
  autoRenameId: string | null
  onAutoRenameDone: () => void
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
  autoRenameId,
  onAutoRenameDone,
  depth,
}: ContainerRowProps) {
  const [expanded, setExpanded] = useState(true)
  /**
   * A row created a moment ago mounts with its field already open, because the
   * "+" that made it is a request to name something — not a request for another
   * "Untitled" to find later.
   */
  const justCreated = node.id === autoRenameId
  const [draftName, setDraftName] = useState<string | null>(
    justCreated ? node.name : null
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [detailsField, setDetailsField] =
    useState<ContainerDetailsField | null>(null)

  const createContainer = useCreateContainer()
  const renameContainer = useRenameContainer()
  const deleteContainer = useDeleteContainer()

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
  const mentionable = node.kind === "character" || node.kind === "scene"

  const commitRename = () => {
    const name = draftName?.trim()
    setDraftName(null)
    if (justCreated) onAutoRenameDone()
    if (name && name !== node.name) {
      renameContainer.mutate({ id: node.id, name })
    }
  }

  /**
   * Escape backs out. On a row that was created for this rename and left with
   * no name at all, backing out removes it: the "+" was a false start, and an
   * unnamed character is exactly the thing this flow exists to stop.
   */
  const cancelRename = () => {
    const typed = draftName?.trim() ?? ""
    setDraftName(null)
    if (!justCreated) return
    onAutoRenameDone()
    // Nothing typed, or the placeholder left as it was: the row is empty in
    // every sense that matters, so backing out takes it with it.
    if (typed === "" || typed === node.name) deleteContainer.mutate(node.id)
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
                {/*
                  The handle is the affordance that says this row is
                  mentionable. Dimmed, after the name, never instead of it.
                */}
                {node.handle ? (
                  <span
                    data-testid="container-handle"
                    className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground"
                  >
                    @{node.handle}
                  </span>
                ) : null}
              </SidebarMenuButton>
            ) : (
              <input
                autoFocus
                aria-label={`Rename ${node.name}`}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename()
                  if (event.key === "Escape") cancelRename()
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
                name: "New folder",
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
          {/* Only a character or a scene is `@`-able; a folder has nothing to
              edit here. */}
          {mentionable ? (
            <>
              <ContextMenuItem onClick={() => setDetailsField("handle")}>
                <HugeiconsIcon icon={Tag01Icon} className="size-4" />
                Edit handle…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setDetailsField("description")}>
                <HugeiconsIcon icon={Note01Icon} className="size-4" />
                Description…
              </ContextMenuItem>
            </>
          ) : null}
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

      {detailsField ? (
        <ContainerDetailsDialog
          node={node}
          field={detailsField}
          open
          onOpenChange={(next) => (next ? undefined : setDetailsField(null))}
        />
      ) : null}

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
              autoRenameId={autoRenameId}
              onAutoRenameDone={onAutoRenameDone}
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
  autoRenameId = null,
  onAutoRenameDone,
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
          autoRenameId={autoRenameId}
          onAutoRenameDone={onAutoRenameDone ?? (() => {})}
          depth={depth}
        />
      ))}
    </SidebarMenu>
  )
}
