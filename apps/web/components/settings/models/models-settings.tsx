"use client"

/**
 * Settings → Models (plan Task 8): the registry card, provider preference,
 * and the family browser, top to bottom.
 *
 * This component owns the one door into the mapping editor. Every entry
 * point — New mapping, a row's Edit / Duplicate / Fix, Import…, and the
 * `?map=<modelKey>` deep link the model picker sends — becomes a
 * `MappingEditorRequest`, and whatever request is open is what the editor
 * shows. The editor itself is Task 9; until then `MappingEditorStub` stands
 * in, showing what would be edited so every entry point is already wired.
 *
 * ⛔ Nothing here reaches a provider.
 */
import { useState } from "react"
import { formatFamilyJson } from "@opendirect/contract"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import type { MappingEditorRequest } from "@/lib/registry/editor-request"

import { FamilyList } from "./family-list"
import { ProviderOrder } from "./provider-order"
import { RegistryStatusCard } from "./registry-status-card"

export interface ModelsSettingsProps {
  /** `?map=<modelKey>`: open the editor on this model once. */
  mapModelKey?: string | null
  /** The editor closed; the page drops `?map=` so it does not reopen. */
  onEditorClosed?: () => void
}

function editorTitle(request: MappingEditorRequest): string {
  const { from } = request
  switch (from.kind) {
    case "blank":
    case "model":
      return "New mapping"
    case "override":
      return from.override.family
        ? `Edit ${from.override.family.name}`
        : "Fix a custom mapping"
    case "duplicate":
      return `Duplicate of ${from.source.name}`
    case "import":
      return "Import mappings"
  }
}

/** What the request carries, as the text the stub shows. */
function editorSubject(request: MappingEditorRequest): string | null {
  const { from } = request
  switch (from.kind) {
    case "blank":
      return null
    case "model":
      return from.modelKey
    case "override":
      return from.override.family
        ? formatFamilyJson(from.override.family)
        : JSON.stringify(from.override.raw, null, 2)
    case "duplicate":
      return formatFamilyJson(from.family)
    case "import":
      return from.candidates
        .map((candidate) => candidate.id ?? "(no id)")
        .join("\n")
  }
}

/**
 * Stands in for the mapping editor (Task 9 replaces it): the right title,
 * and what it was asked to open, so each entry point can be checked now.
 */
function MappingEditorStub({
  request,
  onClose,
}: {
  request: MappingEditorRequest | null
  onClose: () => void
}) {
  const subject = request ? editorSubject(request) : null
  const issues =
    request?.from.kind === "override" ? request.from.override.issues : []
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request ? editorTitle(request) : ""}</DialogTitle>
          <DialogDescription>
            The mapping editor is not in this build yet. Until it is, export a
            mapping as JSON, edit the file and import it again.
          </DialogDescription>
        </DialogHeader>
        {issues.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-destructive">
            {issues.map((issue, index) => (
              <li key={index} className="font-mono break-words">
                {issue.path ? `${issue.path}: ${issue.message}` : issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        {subject ? (
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {subject}
          </pre>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function ModelsSettings({
  mapModelKey = null,
  onEditorClosed,
}: ModelsSettingsProps) {
  const [request, setRequest] = useState<MappingEditorRequest | null>(null)
  const [linkedKey, setLinkedKey] = useState<string | null>(null)

  // A new `?map=` opens the editor once ("adjust state during render": no
  // effect, no extra paint with the editor closed).
  if (mapModelKey !== null && mapModelKey !== linkedKey) {
    setLinkedKey(mapModelKey)
    setRequest({ from: { kind: "model", modelKey: mapModelKey } })
  }

  return (
    <div className="flex flex-col gap-6">
      <RegistryStatusCard />
      <ProviderOrder />
      <FamilyList onOpenEditor={setRequest} />
      <MappingEditorStub
        request={request}
        onClose={() => {
          const fromLink = request?.from.kind === "model"
          setRequest(null)
          if (fromLink) onEditorClosed?.()
        }}
      />
    </div>
  )
}
