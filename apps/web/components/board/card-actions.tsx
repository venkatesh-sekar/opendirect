"use client"

/**
 * What you can do with an output, in one list.
 *
 * The same actions are reachable two ways — right-click anywhere on the
 * tile, or the ⋯ button that appears on hover and is in the tab order — so the
 * list is declared once, as data, and rendered twice. A menu that drifts
 * between its two surfaces is how a keyboard user ends up with fewer options
 * than a mouse user.
 *
 * An action that does not apply is disabled with the reason attached rather
 * than hidden: "why can I not branch from this?" is answerable if the item is
 * still there saying "this file was imported, not generated".
 */
import { useMemo, useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import type { HugeiconsIconProps } from "@hugeicons/react"
import {
  ArrowExpandIcon,
  FolderAddIcon,
  Folder02Icon,
  GitBranchIcon,
  ImageAdd01Icon,
  InformationCircleIcon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons"
import type { AssetDto, ContainerNodeDto } from "@opendirect/contract"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { ContextMenuItem } from "@workspace/ui/components/context-menu"
import { Button } from "@workspace/ui/components/button"

import { useAddAssetToContainer } from "@/hooks/use-assets"
import { useContainerTree } from "@/hooks/use-containers"
import { flattenContainers } from "@/lib/board/sidebar-tree"

type IconDefinition = HugeiconsIconProps["icon"]

export interface OutputAction {
  id: string
  label: string
  icon: IconDefinition
  run: () => void
  /** Why it is off, when it is off. */
  disabledReason?: string | null
}

export interface OutputActionsInput {
  asset: AssetDto
  /** Adds the tile to the creation bar's reference tray. */
  onUseAsReference?: (asset: AssetDto) => void
  onAddTo: () => void
  /** ⛔ Pre-fills the bar from this run. It does not submit. */
  onBranch?: (generationId: string) => void
  onCompare: () => void
  onOpen: () => void
  onReveal: () => void
  onDetails: () => void
  /** False when this board has nothing else to compare against. */
  canCompare: boolean
}

const IMPORTED = "This file was imported, so it has no run behind it."

export function outputActions(input: OutputActionsInput): OutputAction[] {
  const { asset } = input
  const generationId = asset.generationId
  const isMedia = asset.kind !== "text" && asset.kind !== "prompt"

  return [
    {
      id: "reference",
      label: "Use as reference",
      icon: ImageAdd01Icon,
      run: () => input.onUseAsReference?.(asset),
      disabledReason: !input.onUseAsReference
        ? "The creation bar is not open."
        : !isMedia
          ? "Only media can be used as a reference."
          : null,
    },
    {
      id: "add-to",
      label: "Add to…",
      icon: FolderAddIcon,
      run: input.onAddTo,
    },
    {
      id: "branch",
      label: "Branch from this",
      icon: GitBranchIcon,
      run: () => generationId && input.onBranch?.(generationId),
      disabledReason: !generationId
        ? IMPORTED
        : !input.onBranch
          ? "The creation bar is not open."
          : null,
    },
    {
      id: "compare",
      label: "Compare…",
      icon: ArrowExpandIcon,
      run: input.onCompare,
      disabledReason: input.canCompare
        ? null
        : "There is nothing else on this board to compare with.",
    },
    {
      id: "open",
      label: "Open",
      icon: LinkSquare02Icon,
      run: input.onOpen,
      disabledReason: asset.relPath ? null : "This asset has no file.",
    },
    {
      id: "reveal",
      label: "Reveal in folder",
      icon: Folder02Icon,
      run: input.onReveal,
      disabledReason: asset.relPath ? null : "This asset has no file.",
    },
    {
      id: "details",
      label: "Details",
      icon: InformationCircleIcon,
      run: input.onDetails,
      disabledReason: generationId ? null : IMPORTED,
    },
  ]
}

/** The right-click surface. */
export function OutputActionMenuItems({
  actions,
}: {
  actions: readonly OutputAction[]
}): ReactNode {
  return actions.map((action) => (
    <ContextMenuItem
      key={action.id}
      disabled={Boolean(action.disabledReason)}
      title={action.disabledReason ?? undefined}
      onClick={action.run}
    >
      <HugeiconsIcon icon={action.icon} className="size-4" />
      {action.label}
    </ContextMenuItem>
  ))
}

/** The same list, as buttons, for the ⋯ popover. */
export function OutputActionButtons({
  actions,
  onDone,
}: {
  actions: readonly OutputAction[]
  onDone?: () => void
}): ReactNode {
  return (
    <ul className="flex flex-col">
      {actions.map((action) => (
        <li key={action.id}>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            disabled={Boolean(action.disabledReason)}
            title={action.disabledReason ?? undefined}
            onClick={() => {
              action.run()
              onDone?.()
            }}
          >
            <HugeiconsIcon icon={action.icon} className="size-4" />
            {action.label}
          </Button>
        </li>
      ))}
    </ul>
  )
}

export interface AddToContainerDialogProps {
  asset: AssetDto
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "Add to…" — a search over every container in the project.
 *
 * Adding is a *link*, not a move: the asset keeps every board it is already
 * on. That is the whole model of a container, and the confirmation says so.
 */
export function AddToContainerDialog({
  asset,
  open,
  onOpenChange,
}: AddToContainerDialogProps) {
  const tree = useContainerTree(open)
  const add = useAddAssetToContainer()
  const [added, setAdded] = useState<string | null>(null)

  const containers = useMemo<ContainerNodeDto[]>(
    () => flattenContainers(tree.data ?? []).filter((node) => node.kind !== "project"),
    [tree.data]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to a container"
      description="Links this asset to another board. It stays where it is too."
    >
      <CommandInput placeholder="Search containers…" />
      <CommandList>
        <CommandEmpty>
          {tree.isPending ? "Loading containers…" : "No container matches."}
        </CommandEmpty>
        <CommandGroup heading={added ? `Added to ${added}` : "Containers"}>
          {containers.map((container) => (
            <CommandItem
              key={container.id}
              value={`${container.name} ${container.kind}`}
              onSelect={() => {
                add.mutate(
                  { containerId: container.id, assetId: asset.id },
                  {
                    onSuccess: () => {
                      setAdded(container.name)
                      onOpenChange(false)
                    },
                  }
                )
              }}
            >
              <HugeiconsIcon icon={Folder02Icon} className="size-4" />
              <span className="truncate">{container.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {container.kind}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {add.error ? (
        <p role="alert" className="px-3 pb-3 text-xs text-destructive">
          {add.error.message}
        </p>
      ) : null}
    </CommandDialog>
  )
}
