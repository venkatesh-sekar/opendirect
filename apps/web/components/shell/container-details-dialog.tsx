"use client"

/**
 * The two things a character or a scene carries beyond its name: the handle a
 * prompt mentions it by, and the prose that handle becomes on a model with no
 * image input.
 *
 * They live in one dialog because they are one idea — "what does `@venkz`
 * mean?" — and because a project with two dialogs for two fields is two places
 * to look. The right-click menu opens it at whichever field was asked for.
 *
 * Main is the last word on a handle: the pattern is checked here so the error
 * arrives while the user is still typing, and the uniqueness comes back from
 * `containers:setHandle` as a sentence this dialog shows as-is.
 */
import { useState } from "react"
import { isValidHandle, type ContainerDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
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
import { Textarea } from "@workspace/ui/components/textarea"

import {
  useSetContainerDescription,
  useSetContainerHandle,
} from "@/hooks/use-containers"

export type ContainerDetailsField = "handle" | "description"

export interface ContainerDetailsDialogProps {
  node: Pick<ContainerDto, "id" | "name" | "handle" | "description">
  /** Which field the menu item that opened this was about. */
  field?: ContainerDetailsField
  open: boolean
  onOpenChange: (open: boolean) => void
}

const HANDLE_RULE =
  "Lowercase letters, digits and single hyphens, up to 32 characters."

export function ContainerDetailsDialog({
  node,
  field = "handle",
  open,
  onOpenChange,
}: ContainerDetailsDialogProps) {
  const [handle, setHandle] = useState(node.handle ?? "")
  const [description, setDescription] = useState(node.description ?? "")

  const saveHandle = useSetContainerHandle()
  const saveDescription = useSetContainerDescription()

  const trimmedHandle = handle.trim()
  const invalid = trimmedHandle !== "" && !isValidHandle(trimmedHandle)
  const failure = saveHandle.error ?? saveDescription.error

  const save = () => {
    if (invalid) return
    const next = trimmedHandle === "" ? null : trimmedHandle
    const prose = description.trim() === "" ? null : description.trim()

    // Sequenced, not parallel: the handle is the one that can be refused, and
    // a refusal must leave the dialog open with the reason showing.
    saveHandle.mutate(
      { id: node.id, handle: next },
      {
        onSuccess: () =>
          saveDescription.mutate(
            { id: node.id, description: prose },
            { onSuccess: () => onOpenChange(false) }
          ),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{node.name}</DialogTitle>
          <DialogDescription>
            What a prompt gets when it mentions this one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="container-handle">Handle</Label>
          <Input
            id="container-handle"
            autoFocus={field === "handle"}
            value={handle}
            placeholder="venkz"
            onChange={(event) => setHandle(event.target.value)}
          />
          <p
            className={
              invalid
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {invalid
              ? `“${trimmedHandle}” is not a usable handle. ${HANDLE_RULE}`
              : trimmedHandle === ""
                ? `Without one, this cannot be @-mentioned. ${HANDLE_RULE}`
                : `Mentioned as @${trimmedHandle}.`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="container-description">Description</Label>
          <Textarea
            id="container-description"
            autoFocus={field === "description"}
            rows={3}
            value={description}
            placeholder="A tall man in a grey coat…"
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Used in the prompt when the model takes no reference image.
          </p>
        </div>

        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure.message}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              invalid || saveHandle.isPending || saveDescription.isPending
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
