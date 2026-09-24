"use client"

/**
 * The mapping editor (plan Task 9): the first-class UI for the user layer of
 * the registry (design §4). Pick any provider model, see its schema fields,
 * say what each one is — an input with a role, a canonical control, or
 * Advanced — from pre-filled suggestions, watch the canvas preview and the
 * validation update as you go, and save. Export and Copy JSON produce the
 * exact file a pull request to `registry/models/` needs.
 *
 * Every entry point arrives as a `MappingEditorRequest`: New mapping (blank),
 * `?map=<modelKey>` (one catalog model), Edit or Fix (a stored override,
 * valid or not), Duplicate as custom, and Import (one candidate opens
 * directly; several open a chooser first).
 *
 * Validation is the contract's own, run on every change, and main re-runs it
 * on save; a refusal comes back addressed by path and lands under the same
 * rows. Save stays disabled, with the reason, while anything is wrong.
 *
 * ⛔ The only network is loading each endpoint's descriptor
 * (`models:get`, a free `GET`). Saving, import and export are local.
 */
import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  FileExportIcon,
  InformationCircleIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import {
  PROVIDER_NAMES,
  endpointKey,
  formatFamilyJson,
  modelKey,
  parseModelKey,
  type MappingEndpoint,
  type ProviderId,
  type RegistryIssue,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import {
  MappingValidationError,
  useDeleteOverride,
  useExportOverride,
  useRegistryFamilies,
  useRegistryOverrides,
  useSaveOverride,
} from "@/hooks/use-model-registry"
import { modelQueryKey, useModel } from "@/hooks/use-models"
import type {
  MappingEditorRequest,
  MappingEditorSource,
} from "@/lib/registry/editor-request"
import {
  editorReducer,
  emptyEditor,
  endpointNotices,
  fromFamily,
  fromRaw,
  isDirty,
  locateIssue,
  toFamily,
  validateEditor,
  withBaseline,
  type EditorAction,
  type EditorEndpoint,
  type EditorIssue,
  type EditorState,
  type FamilyKind,
  type Repair,
} from "@/lib/registry/editor-state"
import { useKeysSummary, useSettings } from "@/lib/settings"

import { EndpointPicker } from "./endpoint-picker"
import { FieldMappingTable } from "./field-mapping-table"
import { MappingPreview } from "./mapping-preview"

export interface MappingEditorProps {
  /** What to open on; null keeps the editor closed. */
  request: MappingEditorRequest | null
  onClose: () => void
}

const KIND_OPTIONS: ReadonlyArray<{ value: FamilyKind; label: string }> = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
]

const DESCRIPTION_MAX = 500

/** Family fields that show their own issues; the footer shows the rest. */
const FAMILY_FIELDS = ["id", "name", "kind", "description"]

interface IdNotice {
  tone: "info" | "warning"
  text: string
}

// ---------------------------------------------------------------------------
// Opening

/** The request as the editor opens it: an import is one chosen candidate. */
type OpenSource =
  | Exclude<MappingEditorSource, { kind: "import" }>
  | {
      kind: "import"
      candidate: UserOverride
    }

function initialState(source: OpenSource, takenIds: string[]): EditorState {
  const options = { takenIds }
  switch (source.kind) {
    case "blank":
      return emptyEditor(options)
    case "model": {
      const parsed = parseModelKey(source.modelKey)
      const state = emptyEditor(options)
      return parsed
        ? editorReducer(state, {
            type: "addEndpoint",
            provider: parsed.provider,
            model: parsed.slug,
          })
        : state
    }
    case "override":
      return source.override.family
        ? fromFamily(source.override.family, source.override.family.id, options)
        : fromRaw(source.override.raw, source.override.id, options)
    case "duplicate":
      return fromFamily(source.family, null, options)
    case "import":
      return source.candidate.family
        ? fromFamily(source.candidate.family, null, options)
        : fromRaw(source.candidate.raw, null, options)
  }
}

function titleOf(source: OpenSource, state: EditorState): string {
  switch (source.kind) {
    case "blank":
    case "model":
      return "New mapping"
    case "override":
      return source.override.family
        ? `Edit ${source.override.family.name}`
        : "Fix a custom mapping"
    case "duplicate":
      return `Duplicate of ${source.source.name}`
    case "import":
      return `Import ${state.name || state.id || "a mapping"}`
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

// ---------------------------------------------------------------------------
// Endpoint loading

/**
 * Loads one endpoint's descriptor (free `GET`) and hands it to the reducer.
 * A model a family already maps pre-fills from that mapping, so a new
 * mapping of a curated model starts from the curator's work.
 */
function EndpointLoader({
  endpoint,
  index,
  existing,
  dispatch,
}: {
  endpoint: EditorEndpoint
  index: number
  existing: (key: string) => MappingEndpoint | undefined
  dispatch: Dispatch<EditorAction>
}) {
  const key = modelKey(endpoint.provider, endpoint.model)
  const query = useModel(key)
  const { data, error, isFetching } = query
  useEffect(() => {
    if (data) {
      dispatch({
        type: "endpointLoaded",
        index,
        descriptor: data,
        existing: endpoint.mapping ?? existing(key),
      })
    } else if (error && !isFetching) {
      dispatch({ type: "endpointFailed", index, message: error.message })
    }
    // `existing` is read once, when the descriptor lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, error, isFetching, index, dispatch, key, endpoint.mapping])
  return null
}

// ---------------------------------------------------------------------------
// Sections

function FieldIssues({ issues }: { issues: EditorIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((issue) => (
        <li
          key={`${issue.path}:${issue.message}`}
          className="text-xs text-destructive"
        >
          {issue.message}
        </li>
      ))}
    </ul>
  )
}

function FamilySection({
  state,
  issues,
  act,
  notice,
}: {
  state: EditorState
  issues: EditorIssue[]
  act: Dispatch<EditorAction>
  notice: IdNotice | null
}) {
  const nameId = useId()
  const idId = useId()
  const idHint = useId()
  const kindId = useId()
  const descriptionId = useId()
  const at = (path: string) =>
    issues.filter((issue) => issue.where === "family" && issue.path === path)
  const nameIssues = at("name")
  const idIssues = at("id")
  const descriptionIssues = at("description")
  const kindIssues = at("kind")

  return (
    <section
      aria-labelledby={`${nameId}-heading`}
      className="flex flex-col gap-3"
    >
      <h3 id={`${nameId}-heading`} className="text-sm font-medium">
        Model
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            data-issue-path="name"
            value={state.name}
            maxLength={80}
            aria-invalid={nameIssues.length > 0 || undefined}
            placeholder="Kling 3 Pro"
            onChange={(event) =>
              act({ type: "setName", name: event.target.value })
            }
          />
          <FieldIssues issues={nameIssues} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={idId}>ID</Label>
          <Input
            id={idId}
            data-issue-path="id"
            value={state.id}
            className="font-mono"
            aria-describedby={idHint}
            aria-invalid={idIssues.length > 0 || undefined}
            placeholder="kling-3-pro"
            onChange={(event) => act({ type: "setId", id: event.target.value })}
          />
          <p id={idHint} className="text-xs text-muted-foreground">
            {state.idTouched
              ? "Used as the file name if you contribute it."
              : "Follows the name. Used as the file name if you contribute it."}
          </p>
          <FieldIssues issues={idIssues} />
          {notice?.tone === "warning" ? (
            <p
              role="status"
              className="flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium text-foreground"
            >
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-px size-3.5 shrink-0"
                aria-hidden
              />
              {notice.text}
            </p>
          ) : notice ? (
            <p className="text-xs text-muted-foreground">{notice.text}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={kindId}>Kind</Label>
          <Select
            value={state.kind}
            onValueChange={(next) => {
              if (typeof next === "string") {
                act({ type: "setKind", kind: next as FamilyKind })
              }
            }}
          >
            <SelectTrigger
              id={kindId}
              data-issue-path="kind"
              aria-invalid={kindIssues.length > 0 || undefined}
              className="w-full"
            >
              <SelectValue>
                {(value: unknown) =>
                  KIND_OPTIONS.find((option) => option.value === value)
                    ?.label ?? "Kind"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldIssues issues={kindIssues} />
        </div>
        <div className="flex flex-col gap-1.5 sm:row-span-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={descriptionId}>Description</Label>
            <span
              className={cn(
                "text-xs tabular-nums",
                state.description.length > DESCRIPTION_MAX
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {state.description.length}/{DESCRIPTION_MAX}
            </span>
          </div>
          <Textarea
            id={descriptionId}
            data-issue-path="description"
            value={state.description}
            placeholder="Optional: what the model is good at."
            aria-invalid={descriptionIssues.length > 0 || undefined}
            className="min-h-20"
            onChange={(event) =>
              act({ type: "setDescription", description: event.target.value })
            }
          />
          <FieldIssues issues={descriptionIssues} />
        </div>
      </div>
    </section>
  )
}

function EndpointBanner({
  endpoint,
  overrides,
  notices,
}: {
  endpoint: EditorEndpoint
  overrides: string | null
  notices: Repair[]
}) {
  const provider = PROVIDER_NAMES[endpoint.provider]
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <HugeiconsIcon
          icon={InformationCircleIcon}
          className="mt-px size-3.5 shrink-0"
          aria-hidden
        />
        {endpoint.prefill === "mapping"
          ? "Pre-filled from the existing mapping. Suggestions from the schema are shown beside each row."
          : `Pre-filled from the model's schema${endpoint.manifest ? ` and ${provider}'s capability manifest` : ""}. Review each row.`}
      </p>
      {overrides ? (
        <p className="text-xs text-muted-foreground">
          This will override {overrides} for this model.
        </p>
      ) : null}
      {notices.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {notices.map((notice) => (
            <li key={notice.message}>{notice.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** "Check the slug": load the endpoint again under a corrected slug. */
function SlugFix({
  endpoint,
  index,
  onRetry,
  act,
}: {
  endpoint: EditorEndpoint
  index: number
  onRetry: () => void
  act: Dispatch<EditorAction>
}) {
  const [slug, setSlug] = useState(endpoint.model)
  const trimmed = slug.trim()
  const changed = trimmed !== "" && trimmed !== endpoint.model
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed) {
          act({ type: "changeEndpointModel", index, model: trimmed })
        } else {
          onRetry()
        }
      }}
    >
      <Input
        aria-label="Model slug"
        className="h-8 min-w-48 flex-1 bg-background font-mono text-foreground"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
      />
      <Button type="submit" size="sm" variant="outline">
        <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
        {changed ? "Load this slug" : "Retry"}
      </Button>
    </form>
  )
}

function EndpointPanel({
  endpoint,
  index,
  count,
  issues,
  notices,
  overrides,
  act,
}: {
  endpoint: EditorEndpoint
  index: number
  count: number
  issues: EditorIssue[]
  notices: Repair[]
  overrides: string | null
  act: Dispatch<EditorAction>
}) {
  const client = useQueryClient()
  const providerName = endpoint.rawProvider ?? PROVIDER_NAMES[endpoint.provider]
  const where = `${providerName} ${endpoint.model}`
  const own = issues.filter(
    (issue) =>
      issue.where !== "family" &&
      issue.where.endpoint === index &&
      issue.where.field === undefined
  )

  function retry() {
    // Drop the cached failure, so the next mount fetches afresh.
    void client.resetQueries({
      queryKey: modelQueryKey(modelKey(endpoint.provider, endpoint.model)),
      exact: true,
    })
    act({ type: "retryEndpoint", index })
  }

  return (
    <div className="flex flex-col gap-3" data-endpoint={index}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-muted-foreground">
            {index === 0 && count > 1
              ? "Tried first on its provider"
              : count > 1
                ? `Tried ${index + 1} of ${count} on its provider`
                : "Endpoint"}
          </span>
          <span className="font-mono text-sm break-all">{endpoint.model}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${where}`}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-44">
            <DropdownMenuItem
              disabled={index === 0}
              onClick={() =>
                act({ type: "moveEndpoint", index, to: index - 1 })
              }
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} />
              Move left (try earlier)
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === count - 1}
              onClick={() =>
                act({ type: "moveEndpoint", index, to: index + 1 })
              }
            >
              <HugeiconsIcon icon={ArrowRight01Icon} />
              Move right (try later)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => act({ type: "removeEndpoint", index })}
            >
              <HugeiconsIcon icon={Delete02Icon} />
              Remove endpoint
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {endpoint.loading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-3.5 animate-spin"
              aria-hidden
            />
            Loading the fields of {where}…
          </p>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      ) : endpoint.error ? (
        <Alert variant="destructive" tabIndex={-1} data-endpoint-alert={index}>
          <HugeiconsIcon icon={AlertCircleIcon} />
          <AlertTitle>Could not load the fields of {where}</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs break-words">{endpoint.error}</p>
            {endpoint.rawProvider === null ? (
              <p>
                {endpoint.mapping &&
                (Object.keys(endpoint.mapping.inputs).length > 0 ||
                  Object.keys(endpoint.mapping.controls).length > 0)
                  ? "Its mapping is kept as it is, unchecked. "
                  : ""}
                Retry, or check the slug and load it again:
              </p>
            ) : null}
            {own.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {own.map((issue) => (
                  <li key={`${issue.path}:${issue.message}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {endpoint.rawProvider === null ? (
              <SlugFix
                key={endpoint.model}
                endpoint={endpoint}
                index={index}
                onRetry={retry}
                act={act}
              />
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <EndpointBanner
            endpoint={endpoint}
            overrides={overrides}
            notices={notices}
          />
          <FieldMappingTable
            endpoint={endpoint}
            index={index}
            issues={issues}
            dispatch={act}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The editor sheet

function EditorSheet({
  source,
  takenIds,
  onClose,
}: {
  source: OpenSource
  /** The ids of the user's other stored mappings, kept current. */
  takenIds: string[]
  onClose: () => void
}) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    withBaseline(initialState(source, takenIds))
  )
  // An import is new to this computer until it is saved once.
  const [savedOnce, setSavedOnce] = useState(false)
  const [serverIssues, setServerIssues] = useState<RegistryIssue[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState<null | "save" | "export">(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [open, setOpen] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerAlertRef = useRef<HTMLDivElement>(null)

  const families = useRegistryFamilies()
  const settings = useSettings()
  const keys = useKeysSummary()
  const save = useSaveOverride()
  const exportFamily = useExportOverride()
  const remove = useDeleteOverride()

  // The ids an auto-slug avoids follow the stored mappings as they load.
  const takenKey = takenIds.join("\u0000")
  useEffect(() => {
    dispatch({
      type: "setTakenIds",
      ids: takenKey ? takenKey.split("\u0000") : [],
    })
  }, [takenKey])

  /** Every change a person makes clears a refusal that no longer applies. */
  const act: Dispatch<EditorAction> = (action) => {
    setServerIssues([])
    dispatch(action)
  }

  const dirty = (source.kind === "import" && !savedOnce) || isDirty(state)
  const family = useMemo(() => toFamily(state), [state])
  const issues = useMemo(() => {
    const local = validateEditor(state)
    const seen = new Set(local.map((i) => `${i.path}\u0000${i.message}`))
    const remote = serverIssues
      .filter((i) => !seen.has(`${i.path}\u0000${i.message}`))
      .map((i) => ({ ...i, where: locateIssue(state, i.path) }))
    return [...local, ...remote]
  }, [state, serverIssues])
  const schemas = useMemo(() => {
    const out: Record<number, unknown> = {}
    state.endpoints.forEach((endpoint, index) => {
      if (endpoint.inputSchema) out[index] = endpoint.inputSchema
    })
    return out
  }, [state.endpoints])

  const loading = state.endpoints.some((endpoint) => endpoint.loading)
  const valid = issues.length === 0
  const clean =
    !dirty && state.replaceId !== null && state.replaceId === state.id
  /** Saving under this id would replace another of the user's mappings. */
  const replacesOther =
    state.id !== "" &&
    state.id !== state.replaceId &&
    takenIds.includes(state.id)

  /** The mapping in force for each endpoint key, other than this draft. */
  const mappedBy = useMemo(() => {
    const map = new Map<string, { name: string; endpoint: MappingEndpoint }>()
    for (const entry of families.data ?? []) {
      if (entry.family.id === state.replaceId) continue
      for (const endpoint of entry.family.endpoints) {
        map.set(endpointKey(endpoint), { name: entry.family.name, endpoint })
      }
    }
    return map
  }, [families.data, state.replaceId])

  const idNotice = useMemo((): IdNotice | null => {
    if (state.id === "" || state.id === state.replaceId) return null
    if (replacesOther) {
      return {
        tone: "warning",
        text: "You already have a custom mapping with this ID. Saving replaces it; pick another ID to keep both.",
      }
    }
    const entry = families.data?.find((e) => e.family.id === state.id)
    if (entry && entry.source !== "user") {
      return {
        tone: "info",
        text: `Matches the ${entry.source} ${entry.family.name} mapping; yours replaces it on this computer.`,
      }
    }
    return null
  }, [state.id, state.replaceId, replacesOther, families.data])

  // Shown in the footer: the family's issues no field shows. An empty
  // endpoint list already says so where the endpoints go.
  const familyIssues = issues.filter(
    (issue) =>
      issue.where === "family" &&
      !FAMILY_FIELDS.includes(issue.path) &&
      !(issue.path === "endpoints" && state.endpoints.length === 0)
  )
  const configured = (["replicate", "openrouter"] as const).filter(
    (provider) => keys.data?.[provider].present === true
  )
  const providerOrder = settings.data?.providerOrder ?? [
    "replicate",
    "openrouter",
  ]

  function requestClose() {
    if (dirty) setConfirmOpen(true)
    else close()
  }

  function close() {
    setConfirmOpen(false)
    setOpen(false)
    onClose()
  }

  /** Focus a control after the next paint (a tab switch renders first). */
  function focusLater(find: () => HTMLElement | null | undefined) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = find()
        target?.focus()
        target?.scrollIntoView?.({ block: "center" })
      })
    )
  }

  function focusFirstInvalid() {
    focusLater(() =>
      bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    )
  }

  /** "N problems to fix": go to the first one, switching tabs if needed. */
  function jumpToFirstProblem() {
    const first = issues[0]
    if (!first) return
    const body = bodyRef.current
    if (first.where === "family") {
      focusLater(
        () =>
          body?.querySelector<HTMLElement>(
            `[data-issue-path="${CSS.escape(first.path)}"]`
          ) ?? footerAlertRef.current
      )
      return
    }
    const { endpoint, field } = first.where
    dispatch({ type: "setActive", index: endpoint })
    focusLater(() => {
      const panel = body?.querySelector<HTMLElement>(
        `[data-endpoint="${endpoint}"]`
      )
      if (field !== undefined) {
        const row = panel?.querySelector<HTMLElement>(
          `tr[data-field="${CSS.escape(field)}"]`
        )
        const control = row?.querySelector<HTMLElement>('[role="combobox"]')
        if (control) return control
      }
      return (
        panel?.querySelector<HTMLElement>("[data-endpoint-alert]") ??
        panel?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        body?.querySelector<HTMLElement>(`[data-endpoint-tab="${endpoint}"]`)
      )
    })
  }

  function requestSave(then: "close" | "export") {
    if (!valid || loading) return
    if (replacesOther) {
      setReplaceOpen(then === "close" ? "save" : "export")
      return
    }
    runSave(then)
  }

  function runSave(then: "close" | "export") {
    const fixing =
      source.kind === "override" && source.override.family === null
        ? source.override
        : null
    const id = state.id
    const name = state.name
    save.mutate(
      { family, replaceId: state.replaceId },
      {
        onSuccess: (saved) => {
          // A broken entry without an id cannot be replaced by id; the fixed
          // copy is saved, so the broken one goes.
          if (fixing && fixing.id === null && fixing.key !== saved.key) {
            remove.mutate(fixing.key)
          }
          if (then === "export") {
            dispatch({ type: "saved" })
            setSavedOnce(true)
            toast.success(`Saved ${name}`, {
              description: "Now choose where to export it.",
            })
            exportJson(id, name)
            return
          }
          toast.success(`Saved. Canvas nodes using ${name} update now`, {
            description: `Custom mapping ${id}`,
          })
          close()
        },
        onError: (error) => {
          if (error instanceof MappingValidationError) {
            setServerIssues(error.issues)
            focusFirstInvalid()
            return
          }
          toast.error("Could not save the mapping", {
            description: error.message,
          })
        },
      }
    )
  }

  function copyJson() {
    if (!valid) return
    const id = state.id
    navigator.clipboard.writeText(formatFamilyJson(family)).then(
      () =>
        toast.success("Copied", {
          description: `To contribute it, save it as registry/models/${id}.json and open a pull request (see CONTRIBUTING.md).`,
        }),
      (error: unknown) =>
        toast.error("Could not copy", {
          description: error instanceof Error ? error.message : String(error),
        })
    )
  }

  function exportJson(id: string, name: string) {
    exportFamily.mutate(id, {
      onSuccess: (path) => {
        if (path) {
          toast.success(`Exported ${name}`, {
            description: `${path}. To contribute it, add it as registry/models/${id}.json in a pull request (see CONTRIBUTING.md).`,
          })
        }
      },
      onError: (error) =>
        toast.error(`Could not export ${name}`, {
          description: error.message,
        }),
    })
  }

  const saveBlocked = !valid
    ? `Fix ${plural(issues.length, "problem")} first.`
    : loading
      ? "Waiting for the endpoint fields to load."
      : null
  const exportBlocked = !valid
    ? `Fix ${plural(issues.length, "problem")} first.`
    : loading
      ? "Waiting for the endpoint fields to load."
      : null
  const active = state.endpoints[state.active]
  const activeKey = active ? modelKey(active.provider, active.model) : null
  const other = activeKey ? mappedBy.get(activeKey) : undefined
  const slotCount = new Set(
    family.endpoints.flatMap((endpoint) => Object.keys(endpoint.inputs))
  ).size
  const controlCount = new Set(
    family.endpoints.flatMap((endpoint) => Object.keys(endpoint.controls))
  ).size

  const preview = (
    <MappingPreview
      family={family}
      schemas={schemas}
      providerOrder={providerOrder}
      configured={configured}
    />
  )

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 p-0 data-[side=right]:w-full sm:max-w-4xl data-[side=right]:sm:max-w-4xl xl:max-w-6xl data-[side=right]:xl:max-w-6xl"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{titleOf(source, state)}</SheetTitle>
            <SheetDescription>
              Saved on this computer. It overrides the bundled and remote
              registry for this model.
            </SheetDescription>
          </SheetHeader>

          {state.endpoints.map((endpoint, index) =>
            endpoint.loading ? (
              <EndpointLoader
                key={endpoint.uid}
                endpoint={endpoint}
                index={index}
                existing={(key) => mappedBy.get(key)?.endpoint}
                dispatch={dispatch}
              />
            ) : null
          )}

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
            {/* Below xl the preview is not beside the table; this bar keeps
                it one click away wherever the table is scrolled. */}
            <div className="sticky top-0 z-10 border-b bg-popover/95 px-4 py-2 backdrop-blur-sm xl:hidden">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  On the canvas: {plural(slotCount, "slot")},{" "}
                  {plural(controlCount, "control")}
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  aria-expanded={previewOpen}
                  onClick={() => setPreviewOpen((on) => !on)}
                >
                  {previewOpen ? "Hide preview" : "Show preview"}
                </Button>
              </div>
              {previewOpen ? (
                <div className="mt-2 max-h-[45vh] overflow-y-auto pb-1">
                  {preview}
                </div>
              ) : null}
            </div>

            <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <FamilySection
                  state={state}
                  issues={issues}
                  act={act}
                  notice={idNotice}
                />

                <section
                  aria-labelledby="mapping-endpoints"
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3
                        id="mapping-endpoints"
                        className="text-sm font-medium"
                      >
                        Endpoints
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        The provider models that run it. On each provider, the
                        first one that takes the filled inputs is used.
                      </p>
                    </div>
                    <EndpointPicker
                      kind={state.kind}
                      existing={state.endpoints.map((e) =>
                        modelKey(e.provider, e.model)
                      )}
                      ownId={state.replaceId}
                      onPick={(provider: ProviderId, model: string) =>
                        act({ type: "addEndpoint", provider, model })
                      }
                    />
                  </div>

                  {state.endpoints.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Add the provider model this mapping runs on. Its fields
                      appear here, pre-filled with suggestions.
                    </p>
                  ) : (
                    <Tabs
                      value={state.active}
                      onValueChange={(value) =>
                        dispatch({ type: "setActive", index: Number(value) })
                      }
                    >
                      <TabsList className="h-auto max-w-full flex-wrap justify-start">
                        {state.endpoints.map((endpoint, index) => {
                          const broken = issues.some(
                            (issue) =>
                              issue.where !== "family" &&
                              issue.where.endpoint === index
                          )
                          return (
                            <TabsTrigger
                              key={endpoint.uid}
                              value={index}
                              data-endpoint-tab={index}
                              className="max-w-64 flex-none"
                            >
                              <Badge variant="outline" className="font-normal">
                                {endpoint.rawProvider ??
                                  PROVIDER_NAMES[endpoint.provider]}
                              </Badge>
                              <span className="truncate font-mono text-xs">
                                {endpoint.model}
                              </span>
                              {endpoint.loading ? (
                                <HugeiconsIcon
                                  icon={Loading03Icon}
                                  className="size-3 animate-spin"
                                  aria-label="loading"
                                />
                              ) : broken || endpoint.error ? (
                                <HugeiconsIcon
                                  icon={AlertCircleIcon}
                                  className="size-3 text-destructive"
                                  aria-label="has problems"
                                />
                              ) : null}
                            </TabsTrigger>
                          )
                        })}
                      </TabsList>
                      {state.endpoints.map((endpoint, index) => (
                        <TabsContent key={endpoint.uid} value={index}>
                          <EndpointPanel
                            endpoint={endpoint}
                            index={index}
                            count={state.endpoints.length}
                            issues={issues}
                            notices={endpointNotices(state, index)}
                            overrides={
                              index === state.active && other
                                ? other.name
                                : null
                            }
                            act={act}
                          />
                        </TabsContent>
                      ))}
                    </Tabs>
                  )}
                </section>
              </div>

              <aside
                aria-labelledby="mapping-preview"
                className="hidden flex-col gap-3 xl:sticky xl:top-0 xl:flex xl:self-start"
              >
                <div>
                  <h3 id="mapping-preview" className="text-sm font-medium">
                    On the canvas
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    How a node using this model will look.
                  </p>
                </div>
                {preview}
              </aside>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t bg-popover p-3">
            {familyIssues.length > 0 ? (
              <Alert variant="destructive" ref={footerAlertRef} tabIndex={-1}>
                <HugeiconsIcon icon={AlertCircleIcon} />
                <AlertTitle>
                  {familyIssues.length === 1
                    ? "One problem with the mapping"
                    : `${familyIssues.length} problems with the mapping`}
                </AlertTitle>
                <AlertDescription>
                  <ul className="flex flex-col gap-0.5">
                    {familyIssues.map((issue) => (
                      <li key={`${issue.path}:${issue.message}`}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <div
                aria-live="polite"
                className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground"
              >
                {!valid ? (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="h-auto px-0 text-destructive"
                    onClick={jumpToFirstProblem}
                  >
                    {plural(issues.length, "problem")} to fix — show the first
                  </Button>
                ) : loading ? (
                  "Loading endpoint fields…"
                ) : (
                  "Ready to save. To share it upstream, export or copy the JSON and open a pull request (see CONTRIBUTING.md)."
                )}
              </div>
              <Button variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
              <Button variant="outline" disabled={!valid} onClick={copyJson}>
                <HugeiconsIcon icon={Copy01Icon} data-icon="inline-start" />
                Copy JSON
              </Button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex"
                      tabIndex={exportBlocked ? 0 : undefined}
                    />
                  }
                >
                  <Button
                    variant="outline"
                    disabled={
                      exportBlocked !== null ||
                      exportFamily.isPending ||
                      save.isPending
                    }
                    onClick={() =>
                      clean
                        ? exportJson(state.id, state.name)
                        : requestSave("export")
                    }
                  >
                    <HugeiconsIcon
                      icon={FileExportIcon}
                      data-icon="inline-start"
                    />
                    {clean ? "Export JSON…" : "Save & export…"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {exportBlocked ??
                    (clean
                      ? "Writes the file a pull request to registry/models/ needs."
                      : "Save first — or Copy JSON. This saves the mapping, then exports it.")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex"
                      tabIndex={saveBlocked ? 0 : undefined}
                    />
                  }
                >
                  <Button
                    disabled={saveBlocked !== null || save.isPending}
                    onClick={() => requestSave("close")}
                  >
                    {save.isPending ? (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : null}
                    Save mapping
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {saveBlocked ?? "Saves it on this computer."}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This mapping has changes that are not saved. Closing loses them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={replaceOpen !== null}
        onOpenChange={(next) => {
          if (!next) setReplaceOpen(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace your mapping {state.id}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You already have a custom mapping with the ID {state.id}. Saving
              this one replaces it. To keep both, cancel and change the ID.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const then = replaceOpen === "export" ? "export" : "close"
                setReplaceOpen(null)
                runSave(then)
              }}
            >
              Replace it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Import chooser

function ImportChooser({
  candidates,
  onChoose,
  onClose,
}: {
  candidates: UserOverride[]
  onChoose: (candidate: UserOverride) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import mappings</DialogTitle>
          <DialogDescription>
            The file holds {candidates.length} mappings. Open one to review and
            save it; nothing is saved yet.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => {
            const name = candidate.family?.name ?? candidate.id ?? "(no id)"
            const first = candidate.issues[0]
            return (
              <li key={candidate.key}>
                <Button
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-1 py-2 text-left whitespace-normal"
                  onClick={() => onChoose(candidate)}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-medium">{name}</span>
                    {candidate.id ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {candidate.id}
                      </span>
                    ) : null}
                    {candidate.family ? null : (
                      <Badge variant="destructive" className="ml-auto">
                        Needs fixing
                      </Badge>
                    )}
                  </span>
                  {first ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {first.path ? `${first.path}: ` : ""}
                      {first.message}
                    </span>
                  ) : null}
                </Button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------

/**
 * The editor for whatever `request` asks. Each new request starts a fresh
 * draft (the sheet is keyed on it), so nothing leaks between two openings.
 */
export function MappingEditor({ request, onClose }: MappingEditorProps) {
  const overrides = useRegistryOverrides()
  const [seen, setSeen] = useState<MappingEditorRequest | null>(null)
  const [session, setSession] = useState(0)
  const [chosen, setChosen] = useState<UserOverride | null>(null)

  // A new request opens a new session ("adjust state during render").
  if (request !== seen) {
    setSeen(request)
    setSession((n) => n + 1)
    setChosen(null)
  }

  if (request === null) return null
  const { from } = request

  let source: OpenSource | null
  if (from.kind === "import") {
    const only = from.candidates.length === 1 ? from.candidates[0]! : null
    const candidate = chosen ?? only
    if (candidate === null) {
      return (
        <ImportChooser
          candidates={from.candidates}
          onChoose={setChosen}
          onClose={onClose}
        />
      )
    }
    source = { kind: "import", candidate }
  } else {
    source = from
  }

  const takenIds = (overrides.data ?? []).flatMap((entry) =>
    entry.id === null ? [] : [entry.id]
  )

  return (
    <EditorSheet
      key={`${session}:${chosen?.key ?? ""}`}
      source={source}
      takenIds={takenIds}
      onClose={onClose}
    />
  )
}
