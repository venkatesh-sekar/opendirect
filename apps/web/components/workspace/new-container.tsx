"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  FileImportIcon,
  Film02Icon,
  Folder01Icon,
  PlusSignIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { useChooseFiles, useImportAssets } from "@/hooks/use-assets"
import { useCreateContainer } from "@/hooks/use-containers"
import { containerHref } from "@/lib/shell/routes"

export type NewKind = "character" | "scene" | "folder"

const COPY: Record<NewKind, { title: string; body: string; hint: string }> = {
  character: {
    title: "New character",
    body: "Its name becomes the @handle prompts mention it by.",
    hint: "Mira",
  },
  scene: {
    title: "New scene",
    body: "Its name becomes the @handle prompts mention it by.",
    hint: "Hotel hallway",
  },
  folder: {
    title: "New folder",
    body: "A place to keep assets together.",
    hint: "Moodboards",
  },
}

/**
 * Names a container before it exists, then goes to its page.
 *
 * The sidebar's "+" creates a placeholder and opens its row for renaming; a
 * page has no row to open, so it asks first. Either way nothing called
 * "Untitled" is left behind to become a handle nobody would type.
 */
export function NewContainerDialog({
  kind,
  onClose,
}: {
  kind: NewKind
  onClose: () => void
}) {
  const router = useRouter()
  const create = useCreateContainer()
  const [name, setName] = useState("")
  const copy = COPY[kind]

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, kind, parentId: null },
      {
        onSuccess: (created) => {
          onClose()
          router.push(containerHref(created.id))
        },
      }
    )
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-container-name">Name</Label>
            <Input
              id="new-container-name"
              autoFocus
              value={name}
              placeholder={copy.hint}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {create.error ? (
            <p role="alert" className="text-sm text-destructive">
              {create.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={name.trim() === "" || create.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Brings files into the project without filing them anywhere yet — the same
 * import the canvas does, minus the node. Copies files; spends nothing.
 */
function useImportIntoProject() {
  const choose = useChooseFiles()
  const imports = useImportAssets()
  return async () => {
    try {
      const paths = await choose.mutateAsync()
      if (paths.length === 0) return
      const result = await imports.mutateAsync({ paths, containerId: null })
      if (result.failures.length > 0)
        toast.error(`${result.failures.length} files could not be imported`, {
          description: result.failures.map((f) => f.message).join("; "),
        })
      if (result.assets.length > 0)
        toast.success(
          `Imported ${result.assets.length} file${result.assets.length === 1 ? "" : "s"}`
        )
    } catch (error) {
      toast.error("Import failed", {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }
}

/** The top bar's **New ▾**: character, scene, folder, or an import. */
export function NewMenu({ onCreate }: { onCreate: (kind: NewKind) => void }) {
  const importFiles = useImportIntoProject()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
        New
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onCreate("character")}>
          <HugeiconsIcon icon={UserGroupIcon} />
          Character
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCreate("scene")}>
          <HugeiconsIcon icon={Film02Icon} />
          Scene
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCreate("folder")}>
          <HugeiconsIcon icon={Folder01Icon} />
          Folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void importFiles()}>
          <HugeiconsIcon icon={FileImportIcon} />
          Import files…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
