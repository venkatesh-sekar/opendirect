"use client"

/**
 * Settings → Models (plan Task 8): the registry card, provider preference,
 * and the family browser, top to bottom.
 *
 * This component owns the one door into the mapping editor. Every entry
 * point — New mapping, a row's Edit / Duplicate / Fix, Import…, and the
 * `?map=<modelKey>` deep link the model picker sends — becomes a
 * `MappingEditorRequest`, and whatever request is open is what the editor
 * shows, in the mapping editor (Task 9).
 *
 * ⛔ Nothing here reaches a provider.
 */
import { useState } from "react"

import type { MappingEditorRequest } from "@/lib/registry/editor-request"

import { FamilyList } from "./family-list"
import { MappingEditor } from "./mapping-editor"
import { ProviderOrder } from "./provider-order"
import { RegistryStatusCard } from "./registry-status-card"

export interface ModelsSettingsProps {
  /** `?map=<modelKey>`: open the editor on this model once. */
  mapModelKey?: string | null
  /** The editor closed; the page drops `?map=` so it does not reopen. */
  onEditorClosed?: () => void
}

export function ModelsSettings({
  mapModelKey = null,
  onEditorClosed,
}: ModelsSettingsProps) {
  const [request, setRequest] = useState<MappingEditorRequest | null>(null)
  const [linkedKey, setLinkedKey] = useState<string | null>(null)

  // A new `?map=` opens the editor once ("adjust state during render": no
  // effect, no extra paint with the editor closed). When the link is
  // dropped, forget it, so the same link sent again opens the editor again.
  if (mapModelKey !== linkedKey) {
    setLinkedKey(mapModelKey)
    if (mapModelKey !== null) {
      setRequest({ from: { kind: "model", modelKey: mapModelKey } })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RegistryStatusCard />
      <ProviderOrder />
      <FamilyList onOpenEditor={setRequest} />
      <MappingEditor
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
