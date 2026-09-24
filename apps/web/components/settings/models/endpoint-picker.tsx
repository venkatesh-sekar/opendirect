"use client"

/**
 * "+ Add endpoint": pick the provider model a mapping maps (plan Task 9).
 *
 * A searchable list of the whole catalog, grouped by provider and narrowed
 * to the mapping's kind (one click shows every kind). A model a family
 * already maps says so, so nobody maps Seedance twice by accident. A model
 * the catalog does not list — Replicate has far more than its seed
 * collections — is one "Use a model slug…" away; its schema then loads like
 * any other.
 *
 * ⛔ Reads the cached catalog (`models:list`) only. Loading the chosen
 * model's schema is the editor's job, and is a free `GET`.
 */
import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"
import {
  PROVIDER_NAMES,
  endpointKey,
  modelKey,
  providerIdSchema,
  type ModelSummary,
  type ProviderId,
} from "@opendirect/contract"
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
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { useRegistryFamilies } from "@/hooks/use-model-registry"
import { useModels } from "@/hooks/use-models"
import type { FamilyKind } from "@/lib/registry/editor-state"
import { useKeysSummary } from "@/lib/settings"

export interface EndpointPickerProps {
  kind: FamilyKind
  /** Endpoint keys already in the draft. */
  existing: readonly string[]
  /** The draft's own id: its own endpoints are not "mapped by" another. */
  ownId: string | null
  onPick: (provider: ProviderId, model: string) => void
}

/** Rows mounted per provider; the search runs over all of them. */
const GROUP_CAP = 30

const PROVIDERS = providerIdSchema.options

function matches(model: ModelSummary, needle: string): boolean {
  if (!needle) return true
  return (
    model.name.toLowerCase().includes(needle) ||
    model.slug.toLowerCase().includes(needle)
  )
}

function SlugForm({
  onAdd,
}: {
  onAdd: (provider: ProviderId, slug: string) => void
}) {
  const keys = useKeysSummary()
  const hasKey = (provider: ProviderId) =>
    keys.data?.[provider].present === true
  const [provider, setProvider] = useState<ProviderId>(
    () => PROVIDERS.find(hasKey) ?? "replicate"
  )
  const [slug, setSlug] = useState("")
  const trimmed = slug.trim()
  const valid = trimmed !== "" && !/\s/.test(trimmed)
  const usable = hasKey(provider)

  return (
    <form
      className="flex flex-col gap-2 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && usable) onAdd(provider, trimmed)
      }}
    >
      <p className="text-xs text-muted-foreground">
        A model the catalog does not list: its schema loads from the provider.
      </p>
      <div className="flex gap-2">
        <Select
          value={provider}
          onValueChange={(next) => {
            if (typeof next === "string") setProvider(next as ProviderId)
          }}
        >
          <SelectTrigger size="sm" aria-label="Provider" className="w-32">
            <SelectValue>
              {(value: unknown) => PROVIDER_NAMES[value as ProviderId]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((id) => (
              <SelectItem key={id} value={id} disabled={!hasKey(id)}>
                {PROVIDER_NAMES[id]}
                {hasKey(id) ? null : (
                  <span className="text-xs text-muted-foreground">
                    Add a {PROVIDER_NAMES[id]} key to load its schema
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Model slug"
          placeholder="owner/model"
          className="h-8 flex-1 font-mono"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!valid || !usable}>
          Add
        </Button>
      </div>
      {!usable && keys.isSuccess ? (
        <p className="text-xs text-muted-foreground">
          Add a {PROVIDER_NAMES[provider]} key to load its schema.
        </p>
      ) : null}
    </form>
  )
}

export function EndpointPicker({
  kind,
  existing,
  ownId,
  onPick,
}: EndpointPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [allKinds, setAllKinds] = useState(false)
  const [bySlug, setBySlug] = useState(false)
  const models = useModels()
  const families = useRegistryFamilies()

  /** endpoint key → the family that maps it. */
  const mappedBy = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of families.data ?? []) {
      if (entry.family.id === ownId) continue
      for (const endpoint of entry.family.endpoints) {
        map.set(endpointKey(endpoint), entry.family.name)
      }
    }
    return map
  }, [families.data, ownId])

  const needle = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const all = models.data?.models ?? []
    return PROVIDERS.map((provider) => {
      const rows = all.filter(
        (model) =>
          model.provider === provider &&
          (allKinds || model.kind === kind) &&
          matches(model, needle)
      )
      return { provider, rows, held: Math.max(0, rows.length - GROUP_CAP) }
    })
  }, [models.data, allKinds, kind, needle])
  const empty = groups.every((group) => group.rows.length === 0)
  const failures = models.data?.failures ?? []

  function pick(provider: ProviderId, model: string) {
    onPick(provider, model)
    setOpen(false)
    setQuery("")
    setBySlug(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" size="sm" variant="outline" />}
      >
        <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
        Add endpoint
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[28rem] max-w-[calc(100vw-2rem)] p-0"
        aria-label="Add an endpoint"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models by name or slug…"
            value={query}
            onValueChange={setQuery}
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <span>
              {allKinds
                ? "Every kind"
                : `${kind[0]!.toUpperCase()}${kind.slice(1)} models`}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-pressed={allKinds}
              onClick={() => setAllKinds((on) => !on)}
            >
              {allKinds ? `Only ${kind}` : "Show every kind"}
            </Button>
          </div>
          {failures.length > 0 ? (
            <p className="px-3 pb-1 text-xs text-destructive">
              {failures
                .map((f) => `${PROVIDER_NAMES[f.provider]}: ${f.message}`)
                .join(" · ")}
            </p>
          ) : null}
          <CommandList className="h-72">
            {empty ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {models.isPending
                  ? "Loading the model catalog…"
                  : models.isError
                    ? "The model catalog could not be loaded. Use a model slug below."
                    : "No models match. Try every kind, or use a model slug."}
              </p>
            ) : null}
            {groups.map(({ provider, rows, held }) =>
              rows.length > 0 ? (
                <CommandGroup key={provider} heading={PROVIDER_NAMES[provider]}>
                  {rows.slice(0, GROUP_CAP).map((model) => {
                    const key = modelKey(model.provider, model.slug)
                    const added = existing.includes(key)
                    const family = mappedBy.get(key)
                    return (
                      <CommandItem
                        key={key}
                        value={key}
                        disabled={added}
                        onSelect={() => pick(model.provider, model.slug)}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{model.name}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {model.slug}
                          </span>
                        </div>
                        {added ? (
                          <Badge variant="secondary">Added</Badge>
                        ) : family ? (
                          <Badge variant="outline" className="font-normal">
                            Mapped by {family}
                          </Badge>
                        ) : null}
                      </CommandItem>
                    )
                  })}
                  {held > 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {held} more — keep typing to narrow them down.
                    </p>
                  ) : null}
                </CommandGroup>
              ) : null
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="use a model slug"
                onSelect={() => setBySlug((on) => !on)}
              >
                Use a model slug…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        {bySlug ? <SlugForm onAdd={pick} /> : null}
      </PopoverContent>
    </Popover>
  )
}
