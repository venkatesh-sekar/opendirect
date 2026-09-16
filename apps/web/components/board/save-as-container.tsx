"use client"

/**
 * "Save as character" — turning a picture you are looking at into something
 * you can `@` in a prompt.
 *
 * It exists because the alternative is a trip to the sidebar: create a
 * character, find the asset again, add it, then remember to make it the
 * reference. One channel does all four, in one transaction in main.
 *
 * The name is the only thing asked for, because the name is what the handle is
 * derived from — and the handle is shown as it is typed, so nobody presses
 * Save wondering what they will be typing tomorrow.
 *
 * ⛔ Nothing here generates anything. It links an asset that already exists.
 */
import { useState, type ReactElement } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { UserAdd01Icon, Image01Icon } from "@hugeicons/core-free-icons"
import { slugifyHandle, type AssetDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { useCreateContainerFromAsset } from "@/hooks/use-containers"

export type SaveAsKind = "character" | "scene"

const KIND_LABEL: Record<SaveAsKind, string> = {
  character: "character",
  scene: "scene",
}

/**
 * The name to propose: the asset's own, without the extension and without the
 * separators a filename uses in place of spaces.
 *
 * `venkz-sheet-v3.png` → `venkz sheet v3` → `@venkz-sheet-v3`, which is at
 * least recognisably about the picture the user right-clicked.
 */
export function defaultContainerName(asset: AssetDto): string {
  const raw = asset.label ?? asset.originalName ?? ""
  const withoutExtension = raw.replace(/\.[a-z0-9]{1,8}$/i, "")
  const spaced = withoutExtension.replace(/[._-]+/g, " ").trim()
  return spaced === "" ? "New character" : spaced
}

export interface SaveAsContainerDialogProps {
  asset: AssetDto
  kind: SaveAsKind
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SaveAsContainerDialog({
  asset,
  kind,
  open,
  onOpenChange,
}: SaveAsContainerDialogProps) {
  const [name, setName] = useState(() => defaultContainerName(asset))
  const create = useCreateContainerFromAsset()

  const trimmed = name.trim()
  // The same `slugifyHandle` main will run, so the preview cannot lie.
  const handle = slugifyHandle(trimmed)

  const save = () => {
    if (trimmed === "") return
    create.mutate(
      { assetId: asset.id, kind, name: trimmed },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as {KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription>
            Makes a new {KIND_LABEL[kind]} with this image as its reference. The
            image stays everywhere it already is.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="save-as-name">Name</Label>
          <Input
            id="save-as-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save()
            }}
          />
          <p className="text-xs text-muted-foreground">
            {handle ? (
              <>
                Mentionable as{" "}
                <span data-testid="save-as-handle" className="font-mono">
                  @{handle}
                </span>
              </>
            ) : (
              "This name has no handle in it, so it will not be @-mentionable until you rename it."
            )}
          </p>
        </div>

        {create.error ? (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={trimmed === "" || create.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface SaveAsContainerMenuProps {
  asset: AssetDto
  /**
   * The element the menu opens on. Rendered *as* the trigger rather than
   * inside a wrapper, so a tile keeps the box its parent gave it.
   */
  children: ReactElement
}

/** Right-click on a tile: the two things it can become. */
export function SaveAsContainerMenu({
  asset,
  children,
}: SaveAsContainerMenuProps) {
  // Held here rather than in the menu items: the menu unmounts on select, and
  // a dialog whose `open` lives inside it would close with it.
  const [kind, setKind] = useState<SaveAsKind | null>(null)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={children} />
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setKind("character")}>
            <HugeiconsIcon icon={UserAdd01Icon} className="size-4" />
            Save as character
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setKind("scene")}>
            <HugeiconsIcon icon={Image01Icon} className="size-4" />
            Save as scene
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {kind ? (
        <SaveAsContainerDialog
          asset={asset}
          kind={kind}
          open
          onOpenChange={(next) => (next ? undefined : setKind(null))}
        />
      ) : null}
    </>
  )
}
