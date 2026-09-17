"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  workflowSchema,
  type CanvasDto,
  type Workflow,
} from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { invoke } from "@/lib/ipc"
import { queryKeys } from "@/hooks/query-keys"
import { starterWorkflows } from "@/lib/canvas/starter-workflows"
import { readPromptRecipe } from "./prompt-bar"

const STORAGE_KEY = "opendirect.workflow-library.v1"
function download(workflow: Workflow) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `${workflow.name.replace(/[^a-z0-9-]/gi, "-")}.opendirect.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function WorkflowLibrary({ canvas }: { canvas: CanvasDto }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [library, setLibrary] = useState<Workflow[]>([])
  const [incoming, setIncoming] = useState<Workflow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fail = (error: unknown) =>
    setError(
      error instanceof Error ? error.message : "Could not complete this action."
    )
  const persist = (next: Workflow[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setLibrary(next)
  }
  const capture = () =>
    workflowSchema.parse({
      format: "opendirect-workflow",
      version: 1,
      name,
      description,
      nodes: canvas.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        text: node.type === "text" ? node.text : null,
        recipe:
          node.type === "image_gen" || node.type === "video_gen"
            ? readPromptRecipe(node)
            : null,
      })),
      edges: canvas.edges.map((edge) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        slotField: edge.slotField,
      })),
    })
  return (
    <>
      <Button
        className="absolute top-4 right-4 z-10 shadow-sm"
        variant="outline"
        onClick={() => {
          setOpen(true)
          setError(null)
          try {
            const raw: unknown = JSON.parse(
              localStorage.getItem(STORAGE_KEY) ?? "[]"
            )
            if (!Array.isArray(raw))
              throw new Error("Saved workflow library is invalid")
            setLibrary(raw.map((item) => workflowSchema.parse(item)))
          } catch (error) {
            fail(error)
          }
        }}
      >
        Workflow templates
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workflow templates</DialogTitle>
            <DialogDescription>
              Save your canvas as a reusable workflow, or download a template to
              share. Templates include prompts, model choices, settings, and
              connections. Media files and credentials are excluded; reconnect
              reference images after import. Review prompts for private
              information before sharing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl border p-4">
            <Label htmlFor="workflow-name">Template name</Label>
            <Input
              id="workflow-name"
              value={name}
              maxLength={120}
              placeholder="Character exploration → cinematic scene"
              onChange={(e) => setName(e.target.value)}
            />
            <Label htmlFor="workflow-description">Description</Label>
            <Input
              id="workflow-description"
              value={description}
              maxLength={2000}
              placeholder="What does this workflow create?"
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                disabled={!name.trim() || !canvas.nodes.length || busy}
                onClick={() => {
                  try {
                    persist([...library, capture()])
                    setName("")
                    toast.success("Workflow saved on this device")
                  } catch (error) {
                    fail(error)
                  }
                }}
              >
                Save canvas as template
              </Button>
              <Button
                variant="outline"
                disabled={!name.trim() || !canvas.nodes.length || busy}
                onClick={() => {
                  try {
                    download(capture())
                  } catch (error) {
                    fail(error)
                  }
                }}
              >
                Download canvas
              </Button>
            </div>
          </div>
          <Label htmlFor="workflow-import">
            Import a shared workflow (.json, up to 2 MB)
          </Label>
          <Input
            id="workflow-import"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (!file) return
              setError(null)
              setIncoming(null)
              try {
                if (file.size > 2_000_000)
                  throw new Error("Workflow files must be smaller than 2 MB.")
                setIncoming(workflowSchema.parse(JSON.parse(await file.text())))
              } catch {
                setError(
                  "Invalid workflow. Choose a version 1 OpenDirect workflow under 2 MB with valid nodes and connections."
                )
              }
            }}
          />
          {incoming && (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <h3 className="font-medium">{incoming.name}</h3>
              <p className="text-sm text-muted-foreground">
                {incoming.description}
              </p>
              <p className="text-sm">
                {incoming.nodes.length} nodes · {incoming.edges.length}{" "}
                connections
              </p>
              <p className="text-xs break-all text-muted-foreground">
                Models:{" "}
                {[
                  ...new Set(
                    incoming.nodes.flatMap((n) =>
                      n.recipe?.modelKey ? [n.recipe.modelKey] : []
                    )
                  ),
                ].join(", ") || "Choose models after import"}
              </p>
              <p className="text-xs text-muted-foreground">
                Adds a copy beside your canvas. Nothing runs until you review
                each node and press Run. Model availability, credentials, and
                pricing must be checked on your account.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError(null)
                    try {
                      await invoke("canvas:importWorkflow", incoming)
                      await client.invalidateQueries({
                        queryKey: queryKeys.canvas.all,
                      })
                      setIncoming(null)
                      setOpen(false)
                      toast.success("Workflow added", {
                        description:
                          "Reconnect media references and review each model before running.",
                      })
                    } catch (error) {
                      fail(error)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? "Adding…" : "Add to canvas"}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => {
                    try {
                      persist([...library, incoming])
                      setIncoming(null)
                    } catch (error) {
                      fail(error)
                    }
                  }}
                >
                  Save to library
                </Button>
              </div>
            </div>
          )}
          <h3 className="font-medium">Start with a template</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {starterWorkflows.map((workflow) => (
              <button
                key={workflow.name}
                disabled={busy}
                onClick={() => setIncoming(workflow)}
                className="rounded-xl border p-4 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="font-medium">{workflow.name}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {workflow.description}
                </p>
              </button>
            ))}
          </div>
          <h3 className="font-medium">Saved on this device</h3>
          {!library.length && (
            <p className="text-sm text-muted-foreground">
              Your saved templates will appear here. Download a copy to keep a
              portable backup.
            </p>
          )}
          {library.map((workflow, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
            >
              <div className="mr-auto">
                <p className="font-medium">{workflow.name}</p>
                <p className="text-xs text-muted-foreground">
                  {workflow.nodes.length} nodes · {workflow.edges.length}{" "}
                  connections
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setIncoming(workflow)}
              >
                Use template
              </Button>
              <Button variant="ghost" onClick={() => download(workflow)}>
                Download
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  try {
                    persist(library.filter((_, i) => i !== index))
                  } catch (error) {
                    fail(error)
                  }
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
