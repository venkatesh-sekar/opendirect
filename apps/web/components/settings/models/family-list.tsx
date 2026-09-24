"use client"

/**
 * Settings → Models → the family browser (design §3–4, plan Task 8).
 *
 * Every model family in force after the merge, one row each: its name and
 * kind, which layer it came from (bundled with the app, the remote copy from
 * GitHub, or the user's own), the roles its inputs take, the provider models
 * it runs on, and any warnings. Search covers names, ids, providers, model
 * slugs and roles; the chips narrow by source.
 *
 * What a row allows follows from where it came from: anything can be
 * exported or duplicated as the user's own mapping, but only a custom
 * mapping can be edited or deleted — the bundled and remote layers are not
 * the user's to change, only to override.
 *
 * A stored mapping that no longer validates is not in the merge at all, so
 * it is listed first, in its own row, with its first problem and the two
 * ways out: Fix (the editor on its raw JSON) or Delete (by its storage
 * `key`, which even an entry without an id has).
 *
 * ⛔ Local only: the list, delete, import and export never reach the
 * network.
 */
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  AlertCircleIcon,
  Copy01Icon,
  Delete02Icon,
  FileExportIcon,
  FileImportIcon,
  Layers01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import {
  PROVIDER_NAMES,
  REFERENCE_ROLES,
  ROLE_LABELS,
  formatFamilyJson,
  slotKeyRole,
  type ModelFamily,
  type ReferenceRole,
  type RegistryFamilyEntry,
  type RegistrySource,
  type UserOverride,
} from "@opendirect/contract"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import {
  useDeleteOverride,
  useExportOverride,
  useImportOverrides,
  useRegistryFamilies,
  useRegistryOverrides,
} from "@/hooks/use-model-registry"
import {
  duplicateAsCustom,
  type MappingEditorRequest,
} from "@/lib/registry/editor-request"

import { RoleBadge } from "@/components/models/role-badge"

export interface FamilyListProps {
  /** Every editor entry point on this list goes through here. */
  onOpenEditor: (request: MappingEditorRequest) => void
}

type SourceFilter = "all" | RegistrySource

const SOURCE_FILTERS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "bundled", label: "Bundled" },
  { value: "remote", label: "Remote" },
  { value: "user", label: "Custom" },
]

const KIND_LABELS: Record<ModelFamily["kind"], string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
}

const LAYER_NAMES: Record<RegistrySource, string> = {
  bundled: "bundled",
  remote: "remote",
  user: "custom",
}

function SourceBadge({ source }: { source: RegistrySource }) {
  if (source === "user") return <Badge>Custom</Badge>
  if (source === "remote") return <Badge variant="outline">Remote</Badge>
  return <Badge variant="secondary">Bundled</Badge>
}

/** The roles a family's inputs take across every endpoint, in list order. */
function familyRoles(family: ModelFamily): ReferenceRole[] {
  const roles = new Set<ReferenceRole>()
  for (const endpoint of family.endpoints) {
    for (const key of Object.keys(endpoint.inputs)) roles.add(slotKeyRole(key))
  }
  return REFERENCE_ROLES.filter((role) => roles.has(role))
}

/** Everything a search may match, lowercased once. */
function haystack(entry: RegistryFamilyEntry): string {
  const { family } = entry
  const parts = [family.name, family.id, family.kind, LAYER_NAMES[entry.source]]
  for (const endpoint of family.endpoints) {
    parts.push(
      endpoint.provider,
      PROVIDER_NAMES[endpoint.provider],
      endpoint.model
    )
  }
  for (const role of familyRoles(family)) parts.push(role, ROLE_LABELS[role])
  return parts.join(" ").toLowerCase()
}

function matches(entry: RegistryFamilyEntry, query: string): boolean {
  const text = haystack(entry)
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term))
}

function issueLine(issue: { path: string; message: string }): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message
}

/** "1 warning", with every message a tooltip and a screen reader can reach. */
function WarningCount({ warnings }: { warnings: string[] }) {
  const count = warnings.length
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <HugeiconsIcon icon={Alert02Icon} className="size-3.5" aria-hidden />
        {count} {count === 1 ? "warning" : "warnings"}
        <span className="sr-only">: {warnings.join("; ")}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <ul className="flex flex-col gap-1">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

interface DeleteTarget {
  key: string
  name: string
  /** What takes over, e.g. "The bundled mapping takes over again." */
  consequence: string
}

function takesOver(shadows: RegistrySource[]): string {
  const below = shadows.filter((source) => source !== "user")
  if (below.includes("remote")) return "The remote mapping takes over again."
  if (below.includes("bundled")) return "The bundled mapping takes over again."
  return "Models it mapped go back to unverified inputs."
}

interface FamilyRowProps {
  entry: RegistryFamilyEntry
  stored: UserOverride | null
  /**
   * The stored entries are still loading, or failed to: a custom row keeps
   * its Edit and Delete, disabled, rather than silently losing them.
   */
  storedUnavailable: boolean
  /** Every id in use, so a duplicate never lands on one. */
  takenIds: readonly string[]
  onOpenEditor: (request: MappingEditorRequest) => void
  onDelete: (target: DeleteTarget) => void
}

function FamilyRow({
  entry,
  stored,
  storedUnavailable,
  takenIds,
  onOpenEditor,
  onDelete,
}: FamilyRowProps) {
  const { family } = entry
  const exportFamily = useExportOverride()
  const custom = entry.source === "user"
  const roles = familyRoles(family)
  const shadowed = entry.shadows.filter((source) => source !== "user")
  const editable = custom && (stored !== null || storedUnavailable)

  function copyJson() {
    navigator.clipboard.writeText(formatFamilyJson(family)).then(
      () => toast.success(`Copied ${family.name} as JSON`),
      (error: unknown) =>
        toast.error("Could not copy", {
          description: error instanceof Error ? error.message : String(error),
        })
    )
  }

  function exportJson() {
    exportFamily.mutate(family.id, {
      onSuccess: (path) => {
        if (path)
          toast.success(`Exported ${family.name}`, { description: path })
      },
      onError: (error) =>
        toast.error(`Could not export ${family.name}`, {
          description: error.message,
        }),
    })
  }

  return (
    <li
      data-family-name={family.name}
      data-source={entry.source}
      className="flex flex-col gap-2 border-b px-1 py-3 last:border-b-0"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{family.name}</span>
          <Badge variant="outline" className="font-normal">
            {KIND_LABELS[family.kind]}
          </Badge>
          <SourceBadge source={entry.source} />
          {shadowed.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              Overrides{" "}
              {shadowed.map((source) => LAYER_NAMES[source]).join(" and ")}
            </span>
          ) : null}
          {entry.warnings.length > 0 ? (
            <WarningCount warnings={entry.warnings} />
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${family.name}`}
                className="-mt-1 shrink-0"
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-48">
            {editable ? (
              <DropdownMenuItem
                disabled={stored === null}
                onClick={() => {
                  if (stored)
                    onOpenEditor({
                      from: { kind: "override", override: stored },
                    })
                }}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} />
                Edit
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() =>
                onOpenEditor({
                  from: {
                    kind: "duplicate",
                    source: family,
                    family: duplicateAsCustom(family, takenIds),
                  },
                })
              }
            >
              <HugeiconsIcon icon={Layers01Icon} />
              Duplicate as custom
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={exportJson}>
              <HugeiconsIcon icon={FileExportIcon} />
              Export JSON…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyJson}>
              <HugeiconsIcon icon={Copy01Icon} />
              Copy JSON
            </DropdownMenuItem>
            {editable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={stored === null}
                  onClick={() => {
                    if (stored)
                      onDelete({
                        key: stored.key,
                        name: family.name,
                        consequence: takesOver(entry.shadows),
                      })
                  }}
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {roles.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="Roles">
          {roles.map((role) => (
            <RoleBadge key={role} role={role} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No inputs mapped; prompt and controls only.
        </p>
      )}

      <ul
        aria-label={`Where ${family.name} runs`}
        className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground"
      >
        {family.endpoints.map((endpoint) => (
          <li
            key={`${endpoint.provider}:${endpoint.model}`}
            className="break-all"
          >
            {PROVIDER_NAMES[endpoint.provider]} · {endpoint.model}
          </li>
        ))}
      </ul>
    </li>
  )
}

interface InvalidRowProps {
  override: UserOverride
  onFix: () => void
  onDelete: () => void
}

function InvalidOverrideRow({ override, onFix, onDelete }: InvalidRowProps) {
  const [first, ...rest] = override.issues
  return (
    <li
      data-testid="invalid-override"
      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-start"
    >
      <HugeiconsIcon
        icon={AlertCircleIcon}
        className="hidden size-4 shrink-0 text-destructive sm:mt-0.5 sm:block"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium text-destructive">
          Custom mapping can&apos;t be used
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {override.id ?? "(no id)"}
          </span>
        </p>
        {first ? (
          <p className="font-mono text-xs break-words text-muted-foreground">
            {issueLine(first)}
          </p>
        ) : null}
        {rest.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {rest.length} more {rest.length === 1 ? "issue" : "issues"}; Fix
            shows them all.
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" onClick={onFix}>
          <HugeiconsIcon icon={PencilEdit02Icon} data-icon="inline-start" />
          Fix
        </Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
          Delete
        </Button>
      </div>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-label="Loading mappings"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2 border-b py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-52" />
        </div>
      ))}
    </div>
  )
}

export function FamilyList({ onOpenEditor }: FamilyListProps) {
  const families = useRegistryFamilies()
  const overrides = useRegistryOverrides()
  const remove = useDeleteOverride()
  const importOverrides = useImportOverrides()

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SourceFilter>("all")
  // Open state and target are kept apart so the dialog keeps its text
  // while it animates closed.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)

  function askDelete(target: DeleteTarget) {
    setDeleting(target)
    setDeleteOpen(true)
  }

  const all = useMemo(
    () =>
      [...(families.data ?? [])].sort((a, b) =>
        a.family.name.localeCompare(b.family.name)
      ),
    [families.data]
  )
  const invalid = (overrides.data ?? []).filter(
    (entry) => entry.family === null
  )
  /** The stored entry behind a custom row: the newest valid one with its id. */
  const storedById = useMemo(() => {
    const map = new Map<string, UserOverride>()
    for (const entry of overrides.data ?? []) {
      if (!entry.family) continue
      const previous = map.get(entry.family.id)
      if (!previous || previous.updatedAt <= entry.updatedAt) {
        map.set(entry.family.id, entry)
      }
    }
    return map
  }, [overrides.data])

  const counts = useMemo(() => {
    const result: Record<SourceFilter, number> = {
      all: all.length,
      bundled: 0,
      remote: 0,
      user: 0,
    }
    for (const entry of all) result[entry.source] += 1
    return result
  }, [all])
  const storedUnavailable = !overrides.isSuccess
  const takenIds = useMemo(
    () => [
      ...all.map((entry) => entry.family.id),
      ...(overrides.data ?? []).flatMap((entry) =>
        entry.id === null ? [] : [entry.id]
      ),
    ],
    [all, overrides.data]
  )

  const visible = all.filter(
    (entry) =>
      (filter === "all" || entry.source === filter) && matches(entry, query)
  )

  function runImport() {
    importOverrides.mutate(undefined, {
      onSuccess: (candidates) => {
        // Empty means the dialog was cancelled; nothing to say.
        if (candidates.length > 0) {
          onOpenEditor({ from: { kind: "import", candidates } })
        }
      },
      onError: (error) =>
        toast.error("Could not import that file", {
          description: error.message,
        }),
    })
  }

  function confirmDelete() {
    if (!deleting) return
    const target = deleting
    remove.mutate(target.key, {
      onSuccess: () => toast.success(`Deleted ${target.name}`),
      onError: (error) =>
        toast.error(`Could not delete ${target.name}`, {
          description: error.message,
        }),
    })
  }

  const filtering = query.trim() !== "" || filter !== "all"

  return (
    <section aria-labelledby="families-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="families-heading" className="text-base font-medium">
            Model mappings
          </h2>
          <p className="text-sm text-muted-foreground">
            What each model&apos;s inputs mean, and where it runs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={importOverrides.isPending}
            onClick={runImport}
          >
            <HugeiconsIcon icon={FileImportIcon} data-icon="inline-start" />
            Import…
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenEditor({ from: { kind: "blank" } })}
          >
            <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
            New mapping
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search mappings"
            placeholder="Search models, providers, roles"
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Clear first; a second Escape leaves Settings.
              if (event.key === "Escape" && query) {
                event.preventDefault()
                setQuery("")
              }
            }}
          />
        </div>
        <div
          role="group"
          aria-label="Filter mappings by source"
          className="flex flex-wrap items-center gap-1"
        >
          {SOURCE_FILTERS.map((option) => {
            const selected = filter === option.value
            // An empty source reads as 0 and cannot be picked, unless it is
            // the one picked already (so it can still be left).
            const empty =
              option.value !== "all" &&
              families.isSuccess &&
              counts[option.value] === 0
            return (
              <Button
                key={option.value}
                type="button"
                size="sm"
                aria-pressed={selected}
                variant={selected ? "secondary" : "ghost"}
                disabled={empty && !selected}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
                {option.value !== "all" && families.isSuccess ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {counts[option.value]}
                  </span>
                ) : null}
              </Button>
            )
          })}
        </div>
      </div>

      {overrides.isError ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} />
          <AlertTitle>Could not load your custom mappings</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs break-words">
              {overrides.error.message}
            </p>
            <p>
              Until they load, custom mappings cannot be edited or deleted, and
              any that are broken are not listed.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={overrides.isFetching}
              onClick={() => void overrides.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {invalid.length > 0 ? (
        <ul
          aria-label="Custom mappings that can't be used"
          className="flex flex-col gap-2"
        >
          {invalid.map((entry) => (
            <InvalidOverrideRow
              key={entry.key}
              override={entry}
              onFix={() =>
                onOpenEditor({ from: { kind: "override", override: entry } })
              }
              onDelete={() =>
                askDelete({
                  key: entry.key,
                  name: entry.id ?? "this custom mapping",
                  consequence: "It is not in use now, so nothing else changes.",
                })
              }
            />
          ))}
        </ul>
      ) : null}

      {families.isError ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} />
          <AlertTitle>Could not load the model mappings</AlertTitle>
          <AlertDescription>{families.error.message}</AlertDescription>
        </Alert>
      ) : families.isPending ? (
        <ListSkeleton />
      ) : all.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No mappings yet. Map a model yourself with New mapping.
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No mappings match. Map a model yourself with New mapping.
          </p>
          {filtering ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setQuery("")
                setFilter("all")
              }}
            >
              Clear search and filter
            </Button>
          ) : null}
        </div>
      ) : (
        <ul aria-label="Model mappings" className="flex flex-col">
          {visible.map((entry) => (
            <FamilyRow
              key={entry.family.id}
              entry={entry}
              stored={storedById.get(entry.family.id) ?? null}
              storedUnavailable={storedUnavailable}
              takenIds={takenIds}
              onOpenEditor={onOpenEditor}
              onDelete={askDelete}
            />
          ))}
        </ul>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.consequence} This cannot be undone; export it first if
              you may want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
