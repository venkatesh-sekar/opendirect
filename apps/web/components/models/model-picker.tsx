"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useHotkeys } from "react-hotkeys-hook"
import { HugeiconsIcon } from "@hugeicons/react"
import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { familyKey, parseFamilyKey, parseModelKey } from "@opendirect/contract"
import type {
  ModelKind,
  ModelSummary,
  ProviderId,
  ReferenceRole,
} from "@opendirect/contract"
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
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import { RoleBadge } from "@/components/models/role-badge"
import { useCatalogRefreshAccelerator } from "@/hooks/use-app-info"
import {
  useCapabilities,
  useRegistryFamilies,
} from "@/hooks/use-model-registry"
import {
  useModels,
  useRecommendedModels,
  useRefreshModels,
} from "@/hooks/use-models"
import { formatPriceHint } from "@/lib/price"
import {
  buildPickerRows,
  endpointFamilies,
  type FamilyPickerRow,
  type ModelPickerRow,
  type PickerFilter,
} from "@/lib/registry/picker-rows"
import { ROLE_META } from "@/lib/registry/role-meta"
import {
  PROVIDER_LABELS,
  useKeysSummary,
  useSettings,
  useUpdateSettings,
} from "@/lib/settings"

/** The modalities the picker offers, and the label on each filter chip. */
const KIND_FILTERS: Array<{ value: "all" | ModelKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
]

/**
 * The "Takes" chips, most useful first: what people reach for when they have
 * an asset in hand (a character, a look, a frame) before the specialist
 * inputs (structure, motion, sound) and the editing ones (source, mask).
 */
const ROLE_FILTERS: ReferenceRole[] = [
  "character",
  "style",
  "first_frame",
  "last_frame",
  "reference",
  "structure",
  "motion",
  "soundtrack",
  "source",
  "mask",
]

const ALL_PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderId[]

const KIND_LABELS: Record<string, string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
}

/** How many role icons a family row shows before "+N". */
const ROLE_ICON_CAP = 4

export interface ModelPickerProps {
  /**
   * The selected key: a family (`"family:seedance-2-5"`) or a catalog key
   * (`"replicate:bytedance/seedance-2.5"`).
   */
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

/** "First frame + Last frame" for the empty state. */
function roleList(roles: ReferenceRole[]): string {
  return roles.map((role) => ROLE_META[role].label).join(" + ")
}

/** One row: name, provider badge, and the honest price hint. */
function ModelRow({
  summary,
  unavailable,
  unverified,
}: {
  summary: Pick<ModelSummary, "name" | "provider" | "priceHint">
  unavailable?: boolean
  /** Roles guessed from field names: said on the row, dashed like a slot. */
  unverified?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{summary.name}</span>
      <Badge variant="outline">{PROVIDER_LABELS[summary.provider]}</Badge>
      {unverified ? (
        <Badge
          variant="outline"
          className="border-dashed font-normal text-muted-foreground"
        >
          unverified
        </Badge>
      ) : null}
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
 * A family: its name, kind and price on top; below, where it runs (solid for
 * a provider with a key, outlined "no key" otherwise, so a model the user
 * cannot run yet is still discoverable) and what it takes.
 */
function FamilyRow({ row }: { row: FamilyPickerRow }) {
  const { family } = row.entry
  const shown = row.roles.slice(0, ROLE_ICON_CAP)
  const more = row.roles.length - shown.length
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate">{family.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {KIND_LABELS[family.kind] ?? family.kind}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatPriceHint(row.priceHint)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        {row.providers.map((provider) =>
          provider.configured ? (
            <Badge key={provider.id} variant="secondary">
              {PROVIDER_LABELS[provider.id]}
            </Badge>
          ) : (
            <Badge
              key={provider.id}
              variant="outline"
              className="text-muted-foreground"
            >
              {PROVIDER_LABELS[provider.id]}
              <span className="font-normal">no key</span>
            </Badge>
          )
        )}
        {shown.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <span className="sr-only">
              Takes {row.roles.map((role) => ROLE_META[role].label).join(", ")}
            </span>
            {shown.map((role) => (
              <span
                key={role}
                title={ROLE_META[role].label}
                aria-hidden
                className="inline-flex"
              >
                <HugeiconsIcon
                  icon={ROLE_META[role].icon}
                  className="size-3.5"
                />
              </span>
            ))}
            {more > 0 ? (
              <span aria-hidden className="text-xs">
                +{more}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Settings → Models, with the mapping editor open on `modelKey` when given
 * (`?map=`). The router is only asked for inside the open popup, so a picker
 * that is merely mounted needs no app router around it.
 */
function useOpenMappingEditor(onNavigate: () => void) {
  const router = useRouter()
  return (modelKey?: string) => {
    onNavigate()
    router.push(
      modelKey
        ? `/settings?tab=models&map=${encodeURIComponent(modelKey)}`
        : "/settings?tab=models"
    )
  }
}

/** The row's "Map this model…" action; shown on hover, selection or focus. */
function MapModelButton({
  modelKey,
  name,
  onNavigate,
}: {
  modelKey: string
  name: string
  onNavigate: () => void
}) {
  const openEditor = useOpenMappingEditor(onNavigate)
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={`Map this model… (${name})`}
      title="Map this model…"
      className="opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 focus-visible:opacity-100"
      // The row selects on click and on Enter; this button does neither.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        openEditor(modelKey)
      }}
    >
      <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
    </Button>
  )
}

function CreateMappingButton({ onNavigate }: { onNavigate: () => void }) {
  const openEditor = useOpenMappingEditor(onNavigate)
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={() => openEditor()}
    >
      Create a mapping
    </Button>
  )
}

/**
 * The model picker: a `Command` palette in a `Popover`.
 *
 * Groups run **Recommended → Models → Other models**. **Models** are the
 * registry's families: one row per family whatever provider runs it, picked
 * as `family:<id>`. **Other models** are catalog models no mapping covers;
 * they run as they are, but their input roles are guesses (design §4).
 *
 * The **Takes** chips filter by capability (AND across chips). A family
 * matches on its mapping. An unmapped model is left out of a capability
 * filter unless **Include unverified** is on — then it matches on the roles
 * main inferred from its cached schema, marked "unverified", and models main
 * has not inspected yet trail under their own heading rather than being
 * guessed about. When the filter hides unverified models, the list says how
 * many; when it leaves nothing, it says why and offers the two ways forward.
 *
 * Recommended is the curated shortlist from the main process, annotated with
 * whether the catalog still lists each key — an unavailable recommendation is
 * shown greyed out rather than dropped. A recommendation that is an endpoint
 * of a family is shown, and picked, as that family. No row appears twice.
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
  const [roles, setRoles] = useState<ReferenceRole[]>([])
  const [query, setQuery] = useState("")
  const takesId = useId()
  const switchId = useId()

  const models = useModels(kinds)
  const recommended = useRecommendedModels()
  const refresh = useRefreshModels()
  const registry = useRegistryFamilies()
  const capabilities = useCapabilities()
  const settings = useSettings()
  const keys = useKeysSummary()
  // The switch's new position is its own feedback; a toast per flip is noise.
  const updateSettings = useUpdateSettings({ silent: true })

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

  // The caller builds `kinds` in its render body, so key the memo on its
  // contents rather than its identity.
  const kindsKey = kinds?.join(",") ?? ""
  const allFamilies = useMemo(() => registry.data ?? [], [registry.data])
  const families = useMemo(() => {
    const allowed = kindsKey ? kindsKey.split(",") : null
    return allowed
      ? allFamilies.filter((entry) => allowed.includes(entry.family.kind))
      : allFamilies
  }, [allFamilies, kindsKey])
  // Over every family, so the trigger can name any family key it is given.
  const byEndpoint = useMemo(() => endpointFamilies(allFamilies), [allFamilies])

  // Until the key summary arrives, assume every provider is usable rather
  // than flash "no key" on every family.
  const configured = useMemo(
    () =>
      keys.data
        ? ALL_PROVIDERS.filter((provider) => keys.data[provider].present)
        : ALL_PROVIDERS,
    [keys.data]
  )

  // While a flip is in flight, show where it is going, not where it was.
  const includeUnverified =
    updateSettings.isPending &&
    updateSettings.variables?.includeUnverified !== undefined
      ? updateSettings.variables.includeUnverified
      : (settings.data?.includeUnverified ?? false)

  function setIncludeUnverified(next: boolean) {
    updateSettings.mutate({ includeUnverified: next })
  }

  const needle = query.trim().toLowerCase()

  const pickerFilter: PickerFilter = useMemo(
    () => ({ kind: filter, roles, includeUnverified, search: query }),
    [filter, roles, includeUnverified, query]
  )

  const rowInput = useMemo(
    () => ({
      families,
      summaries: all,
      capabilities: capabilities.data ?? {},
      configured,
    }),
    [families, all, capabilities.data, configured]
  )

  const result = useMemo(
    () => buildPickerRows({ ...rowInput, filter: pickerFilter }),
    [rowInput, pickerFilter]
  )

  /**
   * Each chip's count: how many rows would stand if it were (or while it is)
   * pressed — families plus inspected unverified models when those are on.
   * Models nobody has inspected are not counted: nothing says they take it.
   */
  const roleCounts = useMemo(() => {
    const counts = {} as Record<ReferenceRole, number>
    for (const role of ROLE_FILTERS) {
      const withRole = roles.includes(role) ? roles : [...roles, role]
      const rows = buildPickerRows({
        ...rowInput,
        filter: { ...pickerFilter, roles: withRole },
      })
      counts[role] =
        rows.families.length +
        rows.models.filter((row) => row.roles !== null).length
    }
    return counts
  }, [rowInput, pickerFilter, roles])

  /**
   * Recommended rows, resolved against the filtered result: a key that is a
   * family endpoint stands for its family, and whatever is shown here is
   * taken out of the groups below. A recommendation the catalog no longer
   * lists is kept (greyed out) while no role filter is active — nothing is
   * known about what it takes.
   */
  const sections = useMemo(() => {
    const familyByKey = new Map(result.families.map((row) => [row.key, row]))
    const modelByKey = new Map(result.models.map((row) => [row.key, row]))
    const taken = new Set<string>()
    type RecommendedRow =
      | { type: "family"; row: FamilyPickerRow }
      | { type: "model"; row: ModelPickerRow }
      | { type: "missing"; key: string; label: string; available: boolean }
    const recommendedRows: RecommendedRow[] = []

    const groups = recommended.data
    for (const model of groups ? [...groups.video, ...groups.image] : []) {
      const family = byEndpoint.get(model.key)
      const key = family ? familyKey(family.family.id) : model.key
      if (taken.has(key)) continue

      const familyRow = familyByKey.get(key)
      if (familyRow) {
        taken.add(key)
        recommendedRows.push({ type: "family", row: familyRow })
        continue
      }
      if (family || parseFamilyKey(key) !== null) continue

      const modelRow = modelByKey.get(key)
      if (modelRow) {
        taken.add(key)
        recommendedRows.push({ type: "model", row: modelRow })
        continue
      }
      if (
        !byKey.has(key) &&
        roles.length === 0 &&
        (filter === "all" || model.kind === filter) &&
        matches({ name: model.label, key }, needle)
      ) {
        taken.add(key)
        recommendedRows.push({
          type: "missing",
          key,
          label: model.label,
          available: model.available,
        })
      }
    }

    const familyRows = result.families.filter((row) => !taken.has(row.key))
    const rest = result.models.filter((row) => !taken.has(row.key))
    // Under a role filter, uninspected models come last with null roles.
    const inspected =
      roles.length > 0 ? rest.filter((row) => row.roles !== null) : rest
    const uninspected =
      roles.length > 0 ? rest.filter((row) => row.roles === null) : []
    const shown =
      Math.min(inspected.length, GROUP_CAP) +
      Math.min(uninspected.length, GROUP_CAP)
    return {
      recommendedRows,
      familyRows,
      inspected,
      uninspected,
      held: inspected.length + uninspected.length - shown,
      total: recommendedRows.length + familyRows.length + rest.length,
    }
  }, [result, recommended.data, byEndpoint, byKey, roles, filter, needle])

  const empty = sections.total === 0

  /** What the trigger says: the family's name, even for an old endpoint key. */
  const triggerLabel = useMemo(() => {
    if (!value) return null
    const familyId = parseFamilyKey(value)
    if (familyId !== null) {
      return (
        allFamilies.find((entry) => entry.family.id === familyId)?.family
          .name ?? value
      )
    }
    const family = byEndpoint.get(value)
    const parsed = parseModelKey(value)
    if (family && parsed) {
      return `${family.family.name} · ${PROVIDER_LABELS[parsed.provider]}`
    }
    return byKey.get(value)?.name ?? value
  }, [value, allFamilies, byEndpoint, byKey])

  function pick(key: string) {
    onChange(key)
    setOpen(false)
  }

  function toggleRole(role: ReferenceRole) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role]
    )
  }

  /** The family row is ticked for its family key and, on older boards, for
   *  one of its endpoint keys. */
  const selectedFamilyKey = useMemo(() => {
    if (!value) return null
    if (parseFamilyKey(value) !== null) return value
    const family = byEndpoint.get(value)
    return family ? familyKey(family.family.id) : null
  }, [value, byEndpoint])
  const isSelected = (key: string) => selectedFamilyKey === key

  function familyItem(row: FamilyPickerRow, prefix = "") {
    return (
      <CommandItem
        key={`${prefix}${row.key}`}
        value={`${prefix}${row.entry.family.name} ${row.key}`}
        aria-selected={isSelected(row.key)}
        data-checked={isSelected(row.key)}
        onSelect={() => pick(row.key)}
      >
        <FamilyRow row={row} />
      </CommandItem>
    )
  }

  function modelItem(row: ModelPickerRow, prefix = "") {
    const unverified = roles.length > 0 || row.roles !== null
    return (
      <CommandItem
        key={`${prefix}${row.key}`}
        value={`${prefix}${row.summary.name} ${row.key}`}
        aria-selected={value === row.key}
        data-checked={value === row.key}
        onSelect={() => pick(row.key)}
      >
        <ModelRow summary={row.summary} unverified={unverified} />
        <MapModelButton
          modelKey={row.key}
          name={row.summary.name}
          onNavigate={() => setOpen(false)}
        />
      </CommandItem>
    )
  }

  const hidden = result.hiddenUnverified

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
            // The caller may let the chip shrink; a truncated name is still
            // readable on hover.
            title={triggerLabel ?? undefined}
            className={cn("justify-between", className)}
          >
            <span className="truncate">{triggerLabel ?? placeholder}</span>
          </Button>
        }
      />
      <PopoverContent
        className="w-[min(26rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models…"
            value={query}
            onValueChange={setQuery}
          />

          <div
            role="group"
            aria-label="Filter models by modality"
            className="flex items-center gap-1 px-2 pt-1.5"
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

          <div className="flex items-center gap-2 px-2 py-1.5">
            <span
              id={takesId}
              className="shrink-0 text-xs text-muted-foreground"
            >
              Takes
            </span>
            <div
              role="group"
              aria-labelledby={takesId}
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
            >
              {ROLE_FILTERS.map((role) => {
                const pressed = roles.includes(role)
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-4xl border pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      pressed
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <RoleBadge
                      role={role}
                      className="border-transparent bg-transparent"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {roleCounts[role]}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                id={switchId}
                size="sm"
                checked={includeUnverified}
                disabled={!settings.data}
                onCheckedChange={setIncludeUnverified}
              />
              {/* Compact on screen, whole for a screen reader. */}
              <label
                htmlFor={switchId}
                title="Include unverified models in capability filters"
                className="text-xs text-muted-foreground"
              >
                <span aria-hidden>unverified</span>
                <span className="sr-only">Include unverified</span>
              </label>
            </div>
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
              <div
                data-testid="model-picker-empty"
                className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground"
              >
                {models.isLoading ? (
                  <p>Loading the model catalog…</p>
                ) : models.isError ? (
                  <p>
                    The model catalog could not be loaded. Check your API keys
                    in Settings.
                  </p>
                ) : roles.length > 0 ? (
                  <>
                    <p>
                      {includeUnverified
                        ? `No model takes ${roleList(roles)} yet, mapped or inspected.`
                        : `No mapped model takes ${roleList(roles)} yet.`}
                      {!includeUnverified && hidden > 0
                        ? ` ${hidden} unverified ${hidden === 1 ? "model" : "models"} might.`
                        : null}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {!includeUnverified ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          disabled={!settings.data}
                          onClick={() => setIncludeUnverified(true)}
                        >
                          Include unverified
                        </Button>
                      ) : null}
                      <CreateMappingButton onNavigate={() => setOpen(false)} />
                    </div>
                  </>
                ) : (
                  <p>No models match. Try refreshing the catalog.</p>
                )}
              </div>
            ) : null}

            {sections.recommendedRows.length > 0 ? (
              <CommandGroup heading="Recommended">
                {sections.recommendedRows.map((entry) => {
                  if (entry.type === "family")
                    return familyItem(entry.row, "recommended ")
                  if (entry.type === "model")
                    return modelItem(entry.row, "recommended ")
                  return (
                    <CommandItem
                      key={`recommended:${entry.key}`}
                      value={`recommended ${entry.label} ${entry.key}`}
                      disabled={!entry.available}
                      aria-selected={value === entry.key}
                      data-checked={value === entry.key}
                      onSelect={() => pick(entry.key)}
                    >
                      <ModelRow
                        summary={{
                          name: entry.label,
                          // The catalog does not list it, so the key itself
                          // is all that is known about the provider.
                          provider:
                            parseModelKey(entry.key)?.provider ?? "replicate",
                          priceHint: null,
                        }}
                        unavailable={!entry.available}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}

            {sections.familyRows.length > 0 ? (
              <CommandGroup heading="Models">
                {sections.familyRows.map((row) => familyItem(row))}
              </CommandGroup>
            ) : null}

            {sections.inspected.length > 0 ? (
              <CommandGroup heading="Other models">
                {sections.inspected
                  .slice(0, GROUP_CAP)
                  .map((row) => modelItem(row))}
              </CommandGroup>
            ) : null}

            {sections.uninspected.length > 0 ? (
              <CommandGroup heading="Not inspected yet">
                {sections.uninspected
                  .slice(0, GROUP_CAP)
                  .map((row) => modelItem(row))}
              </CommandGroup>
            ) : null}

            {sections.held > 0 ? (
              <p
                data-testid="model-rows-truncated"
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                {sections.held} more — keep typing to narrow them down.
              </p>
            ) : null}

            {!empty && hidden > 0 ? (
              <p
                data-testid="unverified-hidden"
                className="flex flex-wrap items-center gap-1 px-3 py-2 text-xs text-muted-foreground"
              >
                {hidden} unverified {hidden === 1 ? "model" : "models"} hidden
                <span aria-hidden>·</span>
                <Button
                  type="button"
                  size="xs"
                  variant="link"
                  className="h-auto px-0"
                  disabled={!settings.data}
                  onClick={() => setIncludeUnverified(true)}
                >
                  Include unverified
                </Button>
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
