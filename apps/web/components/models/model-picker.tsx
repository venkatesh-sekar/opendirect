"use client"

import { useMemo, useState } from "react"
import { parseModelKey } from "@opendirect/contract"
import type { ModelKind, ModelSummary } from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import {
  useModels,
  useRecommendedModels,
  useRefreshModels,
} from "@/hooks/use-models"
import { formatPriceHint } from "@/lib/price"
import { PROVIDER_LABELS } from "@/lib/settings"

/** The modalities the picker offers, and the label on each filter chip. */
const KIND_FILTERS: Array<{ value: "all" | ModelKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
]

export interface ModelPickerProps {
  /** The selected catalog key (`"replicate:bytedance/seedance-2.5"`). */
  value: string | null
  onChange: (key: string) => void
  /** Restricts the whole picker to these modalities; defaults to video+image. */
  kinds?: ModelKind[]
  placeholder?: string
  disabled?: boolean
}

/** One row: name, provider badge, and the honest price hint. */
function ModelRow({
  summary,
  unavailable,
}: {
  summary: Pick<ModelSummary, "name" | "provider" | "priceHint">
  unavailable?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{summary.name}</span>
      <Badge variant="outline">{PROVIDER_LABELS[summary.provider]}</Badge>
      {unavailable ? (
        <Badge variant="ghost">unavailable</Badge>
      ) : (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatPriceHint(summary.priceHint)}
        </span>
      )}
    </div>
  )
}

/**
 * The model picker: a `Command` palette in a `Popover`.
 *
 * Groups run **Recommended → Video → Image → All**. Recommended is the curated
 * shortlist from the main process, annotated with whether the catalog still
 * lists each key — an unavailable recommendation is shown greyed out rather
 * than dropped, because a slug the providers retired is exactly what a user
 * hunting for it needs to see. The Video and Image groups omit whatever the
 * Recommended group already shows, so no model appears twice; **All** catches
 * any other modality the catalog turns up.
 *
 * Every row carries a price hint, and a model with no published rate says
 * "price unknown" — never `$0.00`. Refreshing the catalog is an explicit
 * item, never something a re-render triggers.
 */
export function ModelPicker({
  value,
  onChange,
  kinds,
  placeholder = "Select a model",
  disabled,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<"all" | ModelKind>("all")

  const models = useModels(kinds)
  const recommended = useRecommendedModels()
  const refresh = useRefreshModels()

  const all = useMemo(() => models.data ?? [], [models.data])
  const byKey = useMemo(
    () => new Map(all.map((model) => [model.key, model])),
    [all]
  )
  const selected = value ? byKey.get(value) : undefined

  const visible = useMemo(
    () => (filter === "all" ? all : all.filter((m) => m.kind === filter)),
    [all, filter]
  )

  const recommendedRows = useMemo(() => {
    const groups = recommended.data
    if (!groups) return []
    return [...groups.video, ...groups.image].filter(
      (model) => filter === "all" || model.kind === filter
    )
  }, [recommended.data, filter])

  const recommendedKeys = useMemo(
    () => new Set(recommendedRows.map((model) => model.key)),
    [recommendedRows]
  )

  const group = (kind: ModelKind) =>
    visible.filter(
      (model) => model.kind === kind && !recommendedKeys.has(model.key)
    )
  const video = group("video")
  const image = group("image")
  const other = visible.filter(
    (model) =>
      model.kind !== "video" &&
      model.kind !== "image" &&
      !recommendedKeys.has(model.key)
  )

  function pick(key: string) {
    onChange(key)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            className="justify-between"
          >
            <span className="truncate">
              {selected?.name ?? value ?? placeholder}
            </span>
          </Button>
        }
      />
      <PopoverContent className="w-[26rem] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models…" />

          <div className="flex items-center gap-1 px-2 py-1.5">
            {KIND_FILTERS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={filter === option.value ? "secondary" : "ghost"}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <CommandList>
            <CommandEmpty>
              {models.isLoading
                ? "Loading the model catalog…"
                : models.isError
                  ? "The model catalog could not be loaded. Check your API keys in Settings."
                  : "No models match. Try refreshing the catalog."}
            </CommandEmpty>

            {recommendedRows.length > 0 ? (
              <CommandGroup heading="Recommended">
                {recommendedRows.map((model) => {
                  const summary = byKey.get(model.key)
                  return (
                    <CommandItem
                      key={`recommended:${model.key}`}
                      value={`recommended ${model.label} ${model.key}`}
                      disabled={!model.available}
                      data-checked={value === model.key}
                      onSelect={() => pick(model.key)}
                    >
                      <ModelRow
                        summary={
                          summary ?? {
                            name: model.label,
                            // The catalog does not list it, so the key itself
                            // is all that is known about the provider.
                            provider:
                              parseModelKey(model.key)?.provider ?? "replicate",
                            priceHint: null,
                          }
                        }
                        unavailable={!model.available}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}

            {[
              { heading: "Video", models: video },
              { heading: "Image", models: image },
              { heading: "All", models: other },
            ].map(({ heading, models: rows }) =>
              rows.length > 0 ? (
                <CommandGroup key={heading} heading={heading}>
                  {rows.map((model) => (
                    <CommandItem
                      key={model.key}
                      value={`${model.name} ${model.key}`}
                      data-checked={value === model.key}
                      onSelect={() => pick(model.key)}
                    >
                      <ModelRow summary={model} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null
            )}

            <CommandSeparator />
            <CommandGroup heading="Catalog">
              <CommandItem
                value="refresh catalog"
                disabled={refresh.isPending}
                onSelect={() => refresh.mutate(kinds)}
              >
                {refresh.isPending ? "Refreshing catalog…" : "Refresh catalog"}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
