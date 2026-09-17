"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ContainerNodeDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { useAssets, useChooseFiles, useImportAssets } from "@/hooks/use-assets"
import { useSetContainerReferences } from "@/hooks/use-containers"
import { useCreateCanvasNode } from "@/hooks/use-canvas"
import { AssetTile, assetLabel } from "@/components/canvas/nodes/asset-tile"
import { requestCanvasFocus } from "@/lib/canvas/focus-request"
import { seedPromptDraft } from "@/components/canvas/prompt-bar"
import { ContainerDetailsDialog } from "./container-details-dialog"

export function SubjectLibrary({
  node,
  onClose,
}: {
  node: ContainerNodeDto
  onClose: () => void
}) {
  const router = useRouter()
  const [offset, setOffset] = useState(0)
  const assets = useAssets(node.id, { limit: 48, offset })
  const choose = useChooseFiles()
  const imports = useImportAssets()
  const save = useSetContainerReferences()
  const create = useCreateCanvasNode()
  const [details, setDetails] = useState(false)
  const [selection, setSelection] = useState<string[] | null>(
    node.referenceAssetIds ?? null
  )
  const [preview, setPreview] = useState<string | null>(null)
  const dirty =
    JSON.stringify(selection) !== JSON.stringify(node.referenceAssetIds ?? null)
  const [discard, setDiscard] = useState(false)
  const busy =
    save.isPending || imports.isPending || choose.isPending || create.isPending
  const fail = (error: unknown) =>
    toast.error(
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again."
    )
  const importImages = async () => {
    try {
      const paths = await choose.mutateAsync()
      if (!paths.length) return
      const result = await imports.mutateAsync({ paths, containerId: node.id })
      if (result.failures.length)
        toast.error(`${result.failures.length} files could not be imported`, {
          description: result.failures.map((f) => f.message).join("; "),
        })
      if (result.assets.length)
        toast.success(`${result.assets.length} assets added to ${node.name}`)
    } catch (error) {
      fail(error)
    }
  }
  const generate = async () => {
    try {
      if (dirty) await save.mutateAsync({ id: node.id, assetIds: selection })
      const made = await create.mutateAsync({
        type: "image_gen",
        containerId: node.id,
        text: JSON.stringify({
          prompt: node.handle
            ? `@${node.handle} `
            : (node.description ?? node.name),
          modelKey: null,
          common: {},
          advanced: {},
          count: 1,
        }),
        x: 120,
        y: 120,
        width: 400,
        height: 400,
      })
      seedPromptDraft(made.id, {
        prompt: node.handle
          ? `@${node.handle} `
          : (node.description ?? node.name),
        modelKey: null,
      })
      requestCanvasFocus(made.id)
      router.push("/")
      onClose()
      toast.success("Image composition created", {
        description: "Choose a model and describe the image to generate.",
      })
    } catch (error) {
      fail(error)
    }
  }
  const image = assets.data?.items.find((asset) => asset.id === preview)
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) {
            if (dirty) setDiscard(true)
            else onClose()
          }
        }}
      >
        <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              {node.kind} library
            </p>
            <DialogTitle className="text-2xl">{node.name}</DialogTitle>
            <DialogDescription>
              {node.description ||
                "Build a consistent reference library. Add images, choose the views you want to use, and create new variations."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 border-b pb-4">
            {node.handle && (
              <span className="mr-auto rounded-md bg-muted px-3 py-1.5 font-mono text-sm">
                @{node.handle}
              </span>
            )}
            <Button variant="outline" onClick={() => setDetails(true)}>
              Edit details
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void importImages()}
            >
              {imports.isPending ? "Importing…" : "Add images"}
            </Button>
            <Button disabled={busy} onClick={() => void generate()}>
              Generate for {node.kind}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Reference images</h3>
              <p className="text-sm text-muted-foreground">
                {selection === null
                  ? "Automatic selection. Choose images below to set your own references."
                  : `${selection.length} selected. Only these images are eligible when you mention this ${node.kind}.`}{" "}
                Model limits may use fewer images.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setSelection(null)}
            >
              Use automatic selection
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto p-1">
            {assets.isPending && (
              <p
                role="status"
                className="p-8 text-center text-muted-foreground"
              >
                Loading library…
              </p>
            )}
            {assets.isError && (
              <div role="alert">
                <p>{assets.error.message}</p>
                <Button onClick={() => void assets.refetch()}>Try again</Button>
              </div>
            )}
            {assets.data?.total === 0 && (
              <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
                <h3 className="font-medium">
                  Give {node.name} a visual identity
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Import reference images or generate a first look using the
                  description.
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void importImages()}
                >
                  Add your first images
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {assets.data?.items.map((asset) => (
                <div
                  key={asset.id}
                  className={`overflow-hidden rounded-xl border bg-card ${selection?.includes(asset.id) ? "ring-2 ring-primary" : ""}`}
                >
                  <button
                    className="block aspect-square w-full overflow-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Preview ${assetLabel(asset)}`}
                    onClick={() => setPreview(asset.id)}
                  >
                    <AssetTile asset={asset} className="size-full" />
                  </button>
                  <div className="space-y-2 p-3">
                    <p
                      className="truncate text-sm font-medium"
                      title={assetLabel(asset)}
                    >
                      {assetLabel(asset)}
                    </p>
                    {asset.kind === "image" ? (
                      <label className="flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`Use ${assetLabel(asset)} as reference`}
                          checked={selection?.includes(asset.id) ?? false}
                          disabled={busy}
                          onChange={(event) =>
                            setSelection((current) =>
                              event.target.checked
                                ? [...(current ?? []), asset.id]
                                : (current ?? []).filter(
                                    (id) => id !== asset.id
                                  )
                            )
                          }
                        />
                        Use as reference
                      </label>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {asset.kind}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {assets.data && assets.data.total > 48 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(offset - 48)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  {offset + 1}–{Math.min(offset + 48, assets.data.total)} of{" "}
                  {assets.data.total}
                </span>
                <Button
                  variant="outline"
                  disabled={assets.data.nextOffset === null}
                  onClick={() => setOffset(assets.data!.nextOffset!)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {dirty
                ? "Reference selection has unsaved changes."
                : "References are saved with this project."}
            </p>
            <Button
              disabled={!dirty || busy}
              onClick={async () => {
                try {
                  await save.mutateAsync({ id: node.id, assetIds: selection })
                  toast.success("References saved")
                } catch (error) {
                  fail(error)
                }
              }}
            >
              {save.isPending ? "Saving…" : "Save references"}
            </Button>
          </div>
          {discard && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <p className="mr-auto text-sm">
                Discard unsaved reference changes?
              </p>
              <Button variant="outline" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" onClick={onClose}>
                Discard changes
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {details && (
        <ContainerDetailsDialog node={node} open onOpenChange={setDetails} />
      )}
      <Dialog open={!!image} onOpenChange={() => setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{image ? assetLabel(image) : "Preview"}</DialogTitle>
            <DialogDescription>
              Review this asset before choosing it as a reference.
            </DialogDescription>
          </DialogHeader>
          {image?.kind === "image" && image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt={assetLabel(image)}
              className="max-h-[65svh] w-full object-contain"
            />
          ) : image ? (
            <AssetTile
              asset={image}
              className="max-h-[65svh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
