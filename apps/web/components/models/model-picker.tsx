"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { parseModelKey } from "@opendirect/contract"
import type { ModelKind, ModelSummary } from "@opendirect/contract"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
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
import { cn } from "@workspace/ui/lib/utils"

import { useCatalogRefreshAccelerator } from "@/hooks/use-app-info"
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
  /**
   * Registers ⌘K / ⌘R while this picker is mounted. On by default because
   * there is one picker in the window; a second one would have to opt out, so
   * that two of them cannot fight over the same chord.
   */
  hotkeys?: boolean
  /** Classes for the trigger — the caller states the chip's width. */
  className?: string
}

/**
 * How many rows of one group are mounted at once.
 *
 * The catalog is the union of several provider collections and is unbounded in
 * principle, while a popup 26rem wide shows about eight rows. Mounting all of
 * them is work nobody sees, paid on every open and again on every keystroke,
 * so each group stops here and says how many it is holding back. Nothing is
 * *hidden*: the search below runs over the whole catalog, so a model past the
 * cap is one word away.
 */
const GROUP_CAP = 25

/** Substring over the name and the key — what someone typing a slug expects. */
function matches(
  model: Pick<ModelSummary, "name" | "key">,
  needle: string
): boolean {
  if (!needle) return true
  return (
    model.name.toLowerCase().includes(needle) ||
    model.key.toLowerCase().includes(needle)
  )
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
 * Groups run **Recommended → Video → Image → Other**. Recommended is the curated
 * shortlist from the main process, annotated with whether the catalog still
 * lists each key — an unavailable recommendation is shown greyed out rather
 * than dropped, because a slug the providers retired is exactly what a user
 * hunting for it needs to see. The Video and Image groups omit whatever the
 * Recommended group already shows, so no model appears twice; **Other** catches
 * any further modality the catalog turns up.
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
  hotkeys = true,
  className,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<"all" | ModelKind>("all")
  const [query, setQuery] = useState("")

  const models = useModels(kinds)
  const recommended = useRecommendedModels()
  const refresh = useRefreshModels()

  /**
   * ⌘K opens the picker from anywhere, including the prompt field — the
   * palette chord every desktop app has trained people to reach for.
   *
   * The refresh chord is **asked for**, not assumed: in development Chromium's
   * menu still owns ⌘R for Reload, so main hands back ⌘⇧R there and ⌘R in
   * production, where the app menu no longer binds reload. Either way it
   * re-fetches the catalog, which is a free listing call, never a generation.
   *
   * Both are declared through `react-hotkeys-hook` rather than a `keydown`
   * listener so that the "is the user typing?" question has one answer in one
   * place instead of one per component.
   */
  const refreshAccelerator = useCatalogRefreshAccelerator()
  useHotkeys(
    "mod+k",
    (event) => {
      event.preventDefault()
      if (!disabled) setOpen(true)
    },
    {
      enabled: hotkeys,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [disabled]
  )

  /**
   * The kinds are read through a ref rather than listed as a dependency: the
   * caller builds the array in its own render body, so depending on it by
   * identity tore down and re-bound this chord on every keystroke of whatever
   * bar the picker sits in.
   */
  const kindsRef = useRef(kinds)
  useEffect(() => {
    kindsRef.current = kinds
  }, [kinds])

  useHotkeys(
    refreshAccelerator,
    (event) => {
      event.preventDefault()
      if (!refresh.isPending) refresh.mutate(kindsRef.current)
    },
    {
      enabled: hotkeys,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [refresh.isPending, refreshAccelerator]
  )

  const all = useMemo(() => models.data?.models ?? [], [models.data])
  const failures = models.data?.failures ?? []
  const byKey = useMemo(
    () => new Map(all.map((model) => [model.key, model])),
    [all]
  )
  const selected = value ? byKey.get(value) : undefined

  const visible = useMemo(
    () => (filter === "all" ? all : all.filter((m) => m.kind === filter)),
    [all, filter]
  )

  const needle = query.trim().toLowerCase()

  const recommendedRows = useMemo(() => {
    const groups = recommended.data
    if (!groups) return []
    return [...groups.video, ...groups.image].filter(
      (model) =>
        (filter === "all" || model.kind === filter) &&
        matches({ name: model.label, key: model.key }, needle)
    )
  }, [recommended.data, filter, needle])

  const recommendedKeys = useMemo(
    () => new Set(recommendedRows.map((model) => model.key)),
    [recommendedRows]
  )

  /**
   * The three catalog groups, filtered once and capped.
   *
   * The search is ours rather than `cmdk`'s (`shouldFilter={false}` below):
   * `cmdk` can only score the rows that are mounted, so a capped list and its
   * filter have to be the same pass. It is a plain substring test run inside a
   * memo — synchronous with the keystroke, no debounce to wait out.
   */
  const groups = useMemo(() => {
    const rest = visible.filter(
      (model) => !recommendedKeys.has(model.key) && matches(model, needle)
    )
    const of = (kind: ModelKind) => rest.filter((model) => model.kind === kind)
    const video = of("video")
    const image = of("image")
    const other = rest.filter(
      (model) => model.kind !== "video" && model.kind !== "image"
    )
    const total = video.length + image.length + other.length
    return {
      rows: [
        { heading: "Video", models: video },
        { heading: "Image", models: image },
        { heading: "Other", models: other },
      ],
      total,
      shown:
        Math.min(video.length, GROUP_CAP) +
        Math.min(image.length, GROUP_CAP) +
        Math.min(other.length, GROUP_CAP),
    }
  }, [visible, recommendedKeys, needle])

  const empty = groups.total === 0 && recommendedRows.length === 0
  const held = groups.total - groups.shown

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
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            className={cn("justify-between", className)}
          >
            <span className="truncate">
              {selected?.name ?? value ?? placeholder}
            </span>
          </Button>
        }
      />
      <PopoverContent className="w-[26rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models…"
            value={query}
            onValueChange={setQuery}
          />

          <div
            role="group"
            aria-label="Filter models by modality"
            className="flex items-center gap-1 px-2 py-1.5"
          >
            {KIND_FILTERS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                aria-pressed={filter === option.value}
                variant={filter === option.value ? "secondary" : "ghost"}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {failures.length > 0 ? (
            <Alert variant="destructive" className="mx-2 mb-1">
              <AlertTitle>Some providers could not be listed</AlertTitle>
              <AlertDescription>
                <ul>
                  {failures.map((failure) => (
                    <li key={failure.provider}>
                      {PROVIDER_LABELS[failure.provider]}: {failure.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {/* A stated height: a list that grows and shrinks with the results
              re-positions the whole popup on every keystroke. */}
          <CommandList className="h-72">
            {empty ? (
              <p
                data-testid="model-picker-empty"
                className="py-6 text-center text-sm text-muted-foreground"
              >
                {models.isLoading
                  ? "Loading the model catalog…"
                  : models.isError
                    ? "The model catalog could not be loaded. Check your API keys in Settings."
                    : "No models match. Try refreshing the catalog."}
              </p>
            ) : null}

            {recommendedRows.length > 0 ? (
              <CommandGroup heading="Recommended">
                {recommendedRows.map((model) => {
                  const summary = byKey.get(model.key)
                  return (
                    <CommandItem
                      key={`recommended:${model.key}`}
                      value={`recommended ${model.label} ${model.key}`}
                      disabled={!model.available}
                      aria-selected={value === model.key}
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

            {groups.rows.map(({ heading, models: rows }) =>
              rows.length > 0 ? (
                <CommandGroup key={heading} heading={heading}>
                  {rows.slice(0, GROUP_CAP).map((model) => (
                    <CommandItem
                      key={model.key}
                      value={`${model.name} ${model.key}`}
                      aria-selected={value === model.key}
                      data-checked={value === model.key}
                      onSelect={() => pick(model.key)}
                    >
                      <ModelRow summary={model} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null
            )}

            {held > 0 ? (
              <p
                data-testid="model-rows-truncated"
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                {held} more — keep typing to narrow them down.
              </p>
            ) : null}

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
