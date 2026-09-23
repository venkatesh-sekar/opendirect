"use client"

/**
 * A container's name, `@handle` and description, edited where they are shown.
 *
 * The three are saved in turn — name, handle, description — and only the
 * ones that changed. The handle goes second because it is the one main can
 * refuse (taken, or not a handle); a refusal stops the chain with the reason
 * showing and the form still open, so nothing after it is half-saved.
 */
import { useState } from "react"
import { isValidHandle, type ContainerNodeDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

import {
  useRenameContainer,
  useSetContainerDescription,
  useSetContainerHandle,
} from "@/hooks/use-containers"

const HANDLE_RULE =
  "Lowercase letters, digits and single hyphens, up to 32 characters."

export function ContainerDetailsForm({
  node,
  onDone,
}: {
  node: ContainerNodeDto
  onDone: () => void
}) {
  const [name, setName] = useState(node.name)
  const [handle, setHandle] = useState(node.handle ?? "")
  const [description, setDescription] = useState(node.description ?? "")
  const rename = useRenameContainer()
  const saveHandle = useSetContainerHandle()
  const saveDescription = useSetContainerDescription()
  const [error, setError] = useState<string | null>(null)

  const mentionable = node.kind === "character" || node.kind === "scene"
  const trimmedName = name.trim()
  const trimmedHandle = handle.trim()
  const invalidHandle = trimmedHandle !== "" && !isValidHandle(trimmedHandle)
  const busy =
    rename.isPending || saveHandle.isPending || saveDescription.isPending

  const save = async () => {
    if (trimmedName === "" || invalidHandle) return
    setError(null)
    const nextHandle = trimmedHandle === "" ? null : trimmedHandle
    const nextDescription =
      description.trim() === "" ? null : description.trim()
    try {
      if (trimmedName !== node.name)
        await rename.mutateAsync({ id: node.id, name: trimmedName })
      if (mentionable && nextHandle !== (node.handle ?? null))
        await saveHandle.mutateAsync({ id: node.id, handle: nextHandle })
      if (nextDescription !== (node.description ?? null))
        await saveDescription.mutateAsync({
          id: node.id,
          description: nextDescription,
        })
      onDone()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Something went wrong. Please try again."
      )
    }
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`name-${node.id}`}>Name</Label>
        <Input
          id={`name-${node.id}`}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {mentionable ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`handle-${node.id}`}>Handle</Label>
          <Input
            id={`handle-${node.id}`}
            value={handle}
            className="font-mono"
            onChange={(event) => setHandle(event.target.value)}
          />
          <p
            className={
              invalidHandle
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {invalidHandle
              ? `“${trimmedHandle}” is not a usable handle. ${HANDLE_RULE}`
              : trimmedHandle === ""
                ? `Without one, this cannot be @-mentioned. ${HANDLE_RULE}`
                : `Mentioned as @${trimmedHandle}.`}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`description-${node.id}`}>Description</Label>
        <Textarea
          id={`description-${node.id}`}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {mentionable ? (
          <p className="text-xs text-muted-foreground">
            What a mention becomes on a model that takes no image.
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || trimmedName === "" || invalidHandle}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
