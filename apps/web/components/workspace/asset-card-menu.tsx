"use client"

/**
 * What you can do to one card in a container's asset grid: move it to another
 * container, edit it (the grid passes those in — Crop… on an image), or
 * delete it from the project.
 *
 * The same list is reachable two ways — right-click anywhere on the card, or
 * the ⋯ button beside its name, which shows on hover and is in the tab order —
 * so it is declared once, as data (`assetCardActions`), and rendered twice.
 * That is the rule `board/card-actions.tsx` follows for a run's outputs: a
 * menu that drifts between its two surfaces is how a keyboard user ends up
 * with fewer options than a mouse user.
 *
 * The dialogs live once per grid (`useAssetCardMenu`), not once per card: a
 * grid of 120 cards does not need 240 dialog subtrees nobody has opened.
 *
 * ⛔ Nothing here spends money. Moving re-files; deleting removes.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import type { HugeiconsIconProps } from "@hugeicons/react"
import {
  Delete02Icon,
  Folder02Icon,
  FolderTransferIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import type { AssetDto, ContainerNodeDto } from "@opendirect/contract"
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
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { useDeleteAsset, useMoveAsset } from "@/hooks/use-assets"
import { useContainerTree } from "@/hooks/use-containers"
import { placesToFile } from "@/lib/board/sidebar-tree"

import { assetLabel } from "@/components/canvas/nodes/asset-tile"

type IconDefinition = HugeiconsIconProps["icon"]

export interface AssetCardAction {
  id: string
  label: string
  icon: IconDefinition
  run: () => void
  /** Destructive items are drawn in red and set off by a separator. */
  destructive?: boolean
}

export interface AssetCardActionsInput {
  onMove: () => void
  onDelete: () => void
  /**
   * Edits of the asset itself — e.g. "Crop…" — listed after Move and before
   * the destructive group. The grid decides which apply to which card.
   */
  edits?: readonly AssetCardAction[]
}

/** The card's menu, in order: filing, edits, then the one that cannot be undone. */
export function assetCardActions(
  input: AssetCardActionsInput
): AssetCardAction[] {
  return [
    {
      id: "move",
      label: "Move to…",
      icon: FolderTransferIcon,
      run: input.onMove,
    },
    ...(input.edits ?? []),
    {
      id: "delete",
      label: "Delete…",
      icon: Delete02Icon,
      run: input.onDelete,
      destructive: true,
    },
  ]
}

/** True where a separator goes: before the first destructive item. */
function startsDestructive(
  actions: readonly AssetCardAction[],
  index: number
): boolean {
  return (
    index > 0 &&
    Boolean(actions[index]!.destructive) &&
    !actions[index - 1]!.destructive
  )
}

/**
 * Right-click anywhere on the card. `render` makes the trigger *be* the card's
 * own element (its `<li>`), so wrapping a card adds no node to the grid.
 */
export function AssetCardContextMenu({
  actions,
  render,
  className,
  children,
}: {
  actions: readonly AssetCardAction[]
  render?: ReactElement
  className?: string
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={render} className={className}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action, index) => (
          <ContextMenuGroupItem
            key={action.id}
            action={action}
            separated={startsDestructive(actions, index)}
          />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ContextMenuGroupItem({
  action,
  separated,
}: {
  action: AssetCardAction
  separated: boolean
}) {
  return (
    <>
      {separated ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        variant={action.destructive ? "destructive" : "default"}
        onClick={action.run}
      >
        <HugeiconsIcon icon={action.icon} className="size-4" />
        {action.label}
      </ContextMenuItem>
    </>
  )
}

/**
 * The ⋯ button. Hidden until the card is hovered or the button is focused, and
 * kept visible while its menu is open, so keyboard users find it by tabbing.
 */
export function AssetCardMenuButton({
  actions,
  label,
  className,
}: {
  actions: readonly AssetCardAction[]
  /** The card's name, for the button's accessible name. */
  label: string
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`More actions for ${label}`}
            className={cn(
              "shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
              className
            )}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map((action, index) => (
          <DropdownGroupItem
            key={action.id}
            action={action}
            separated={startsDestructive(actions, index)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DropdownGroupItem({
  action,
  separated,
}: {
  action: AssetCardAction
  separated: boolean
}) {
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        variant={action.destructive ? "destructive" : "default"}
        onClick={action.run}
      >
        <HugeiconsIcon icon={action.icon} className="size-4" />
        {action.label}
      </DropdownMenuItem>
    </>
  )
}

export interface MoveAssetDialogProps {
  asset: AssetDto
  /** The container the asset is being moved out of — the page it is on. */
  from: Pick<ContainerNodeDto, "id" | "name">
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (target: ContainerNodeDto) => void
  pending?: boolean
}

/**
 * "Move to…" — a search over every other container in the project.
 *
 * Unlike "Add to…" on a run's output, this is a *move*: the asset leaves this
 * page. The file, the canvas and every run that used it are untouched, so
 * nothing that points at it breaks; it only stops being one of this
 * container's references.
 */
export function MoveAssetDialog({
  asset,
  from,
  open,
  onOpenChange,
  onPick,
  pending,
}: MoveAssetDialogProps) {
  const tree = useContainerTree(open)
  const targets = useMemo<ContainerNodeDto[]>(
    () => placesToFile(tree.data ?? []).filter((node) => node.id !== from.id),
    [tree.data, from.id]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${assetLabel(asset)}`}
      description={`Moves it out of ${from.name} and into the container you pick.`}
    >
      {/* `CommandDialog` is only the dialog; cmdk's context is `Command`. */}
      <Command>
        <CommandInput placeholder="Search containers…" />
        <CommandList>
          <CommandEmpty>
            {tree.isPending ? "Loading containers…" : "No container matches."}
          </CommandEmpty>
          <CommandGroup heading="Move to">
            {targets.map((target) => (
              <CommandItem
                key={target.id}
                value={`${target.name} ${target.kind} ${target.id}`}
                disabled={pending}
                onSelect={() => onPick(target)}
              >
                <HugeiconsIcon icon={Folder02Icon} className="size-4" />
                <span className="truncate">{target.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {target.kind}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export interface DeleteAssetDialogProps {
  asset: AssetDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  pending?: boolean
}

/**
 * The confirmation a delete has to pass. There is no undo — the file goes —
 * so the copy says exactly what goes with it and what stays.
 */
export function DeleteAssetDialog({
  asset,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: DeleteAssetDialogProps) {
  const label = assetLabel(asset)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is removed from the project, along with every container,
            reference list and canvas node that shows it. Runs that made or used
            it keep their records, but a run that used it can no longer be
            retried. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One grid's worth of card menus: the action list for any card, and the two
 * dialogs those actions open, mounted once and only while open.
 *
 * The mutations live here, with the grid, rather than in the dialogs: a
 * dialog unmounts the moment it closes, and a mutation's per-call callbacks
 * die with the component that called it — the "Deleted" toast would never
 * show.
 */
export function useAssetCardMenu(
  container: Pick<ContainerNodeDto, "id" | "name">
): {
  /** The card's menu; `edits` go between Move and Delete (see `assetCardActions`). */
  actionsFor: (
    asset: AssetDto,
    edits?: readonly AssetCardAction[]
  ) => AssetCardAction[]
  dialogs: ReactNode
} {
  const [moving, setMoving] = useState<AssetDto | null>(null)
  const [deleting, setDeleting] = useState<AssetDto | null>(null)
  const move = useMoveAsset()
  const remove = useDeleteAsset()

  const actionsFor = (asset: AssetDto, edits?: readonly AssetCardAction[]) =>
    assetCardActions({
      onMove: () => setMoving(asset),
      onDelete: () => setDeleting(asset),
      edits,
    })

  const moveTo = (asset: AssetDto, target: ContainerNodeDto) =>
    move.mutate(
      {
        assetId: asset.id,
        fromContainerId: container.id,
        toContainerId: target.id,
      },
      {
        onSuccess: () => {
          toast.success(`Moved ${assetLabel(asset)} to ${target.name}`)
          setMoving(null)
        },
        onError: (error) =>
          toast.error(`Could not move ${assetLabel(asset)}`, {
            description: error.message,
          }),
      }
    )

  const confirmDelete = (asset: AssetDto) => {
    const label = assetLabel(asset)
    remove.mutate(asset.id, {
      onSuccess: () => toast.success(`Deleted “${label}”`),
      onError: (error) =>
        toast.error(`Could not delete “${label}”`, {
          description: error.message,
        }),
    })
  }

  const dialogs = (
    <>
      {moving ? (
        <MoveAssetDialog
          asset={moving}
          from={container}
          open
          onOpenChange={(open) => !open && setMoving(null)}
          onPick={(target) => moveTo(moving, target)}
          pending={move.isPending}
        />
      ) : null}
      {deleting ? (
        <DeleteAssetDialog
          asset={deleting}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
          pending={remove.isPending}
        />
      ) : null}
    </>
  )

  return { actionsFor, dialogs }
}
