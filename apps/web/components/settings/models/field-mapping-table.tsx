"use client"

/**
 * One endpoint's fields, and what each one is in the family (plan Task 9).
 *
 * A row per field of the provider's own schema: its name, type and
 * description; what it maps to — an input with a role, a canonical control,
 * or nothing (Advanced, where the generated form still shows it); the
 * details of that choice; and the suggestion the schema implies, with how
 * sure it is, to accept in one click.
 *
 * The role picker is the heart of it. Roles are a closed list, so each one
 * is offered with its one-line meaning under the question every role
 * answers: what does this input control in the output? `reference` is last
 * and is the safe answer when unsure (design §2).
 *
 * A problem is shown under the row it is about, and the row's picker is
 * marked invalid, so nothing has to be matched up by path.
 *
 * ⛔ Presentational: dispatches to the editor's reducer, fetches nothing.
 */
import { useId, useState, type Dispatch } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowTurnBackwardIcon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import {
  CONTROL_NAMES,
  PROVIDER_NAMES,
  SHAPE_NAMES,
  slotKeyRole,
  type ControlName,
  type MappingInput,
  type ReferenceRole,
  type SuggestionConfidence,
} from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { CONTROL_META } from "@/lib/registry/control-meta"
import {
  ROLE_ORDER,
  inputTarget,
  sameTarget,
  type EditorAction,
  type EditorEndpoint,
  type EditorIssue,
  type FieldRow,
  type RowTarget,
} from "@/lib/registry/editor-state"
import { KIND_META, ROLE_META, roleMeta } from "@/lib/registry/role-meta"

import { ValueMapEditor, enumOf } from "./value-map-editor"

export interface FieldMappingTableProps {
  endpoint: EditorEndpoint
  index: number
  /** Every editor issue; the table keeps this endpoint's. */
  issues: EditorIssue[]
  dispatch: Dispatch<EditorAction>
}

type RowFilter = "all" | "mapped" | "inputs" | "problems"

const FILTERS: ReadonlyArray<{ value: RowFilter; label: string }> = [
  { value: "all", label: "All fields" },
  { value: "mapped", label: "Mapped" },
  { value: "inputs", label: "Inputs only" },
  { value: "problems", label: "Problems" },
]

/** Longer than this, a description folds to two lines with a toggle. */
const LONG_DESCRIPTION = 140

const KINDS: MappingInput["kind"][] = ["image", "video", "audio", "any"]

const CONFIDENCE: Record<
  SuggestionConfidence,
  { label: string; className: string; variant: "default" | "outline" }
> = {
  manifest: { label: "provider", className: "", variant: "default" },
  schema: { label: "schema", className: "", variant: "outline" },
  name: { label: "name", className: "border-dashed", variant: "outline" },
  none: {
    label: "guess",
    className: "border-dashed text-muted-foreground",
    variant: "outline",
  },
}

// ---------------------------------------------------------------------------
// Helpers

function typeLabel(row: FieldRow): string {
  if (row.missing) return "not in schema"
  const schema = row.schema
  const options = enumOf(schema)
  if (options) return `enum(${options.length})`
  if (row.isUri) return row.isArray ? "uri[]" : "uri"
  if (schema.type === "array") {
    const items = schema.items as Record<string, unknown> | undefined
    return `${typeof items?.type === "string" ? items.type : "any"}[]`
  }
  return typeof schema.type === "string" ? schema.type : "any"
}

function targetValue(target: RowTarget): string {
  if (target.kind === "input") return `input:${slotKeyRole(target.key)}`
  if (target.kind === "control") return `control:${target.control}`
  return "advanced"
}

function targetLabel(target: RowTarget): string {
  if (target.kind === "input") {
    // Defensive: a key that is not a role reads as reference.
    const label = roleMeta(target.key).label
    const position = target.key.split(":")[1]
    return position ? `${label} ${position}` : label
  }
  if (target.kind === "control") return CONTROL_META[target.control].label
  return "Advanced"
}

/** "Image · up to 30 · required · “Face photo”". */
function inputSummary(input: MappingInput): string {
  const parts = [KIND_META[input.kind]?.label ?? input.kind]
  if (input.max !== undefined) parts.push(`up to ${input.max}`)
  if (input.required) parts.push("required")
  if (input.label) parts.push(`“${input.label}”`)
  return parts.join(" · ")
}

function describeField(row: FieldRow): string | null {
  const description = row.schema.description
  return typeof description === "string" && description.trim() !== ""
    ? description
    : null
}

// ---------------------------------------------------------------------------
// Cells

function MapsToSelect({
  row,
  usedBy,
  invalid,
  describedBy,
  onChange,
}: {
  row: FieldRow
  usedBy: Map<ControlName, string>
  invalid: boolean
  describedBy: string | undefined
  onChange: (target: RowTarget) => void
}) {
  const canBeInput = row.isUri || row.isArray || row.target.kind === "input"
  return (
    <Select
      value={targetValue(row.target)}
      onValueChange={(next) => {
        if (typeof next !== "string") return
        if (next === "advanced") return onChange({ kind: "advanced" })
        const [kind, name] = next.split(":") as [string, string]
        if (kind === "input") {
          return onChange(inputTarget(row, name as ReferenceRole))
        }
        const control = name as ControlName
        const values =
          row.target.kind === "control" && row.target.control === control
            ? row.target.values
            : undefined
        onChange(
          values === undefined
            ? { kind: "control", control }
            : { kind: "control", control, values }
        )
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Maps to for ${row.field}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="w-full min-w-44"
      >
        <SelectValue>
          {() => {
            const target = row.target
            if (target.kind === "input") {
              const meta = roleMeta(target.key)
              return (
                <>
                  <HugeiconsIcon icon={meta.icon} aria-hidden />
                  {targetLabel(target)}
                </>
              )
            }
            if (target.kind === "control") {
              return (
                <>
                  <span className="text-muted-foreground">Control</span>
                  {targetLabel(target)}
                </>
              )
            }
            return (
              <span className="text-muted-foreground">Advanced (unmapped)</span>
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-96 min-w-80" alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectItem value="advanced">
            <span className="flex flex-col">
              <span>Advanced (leave unmapped)</span>
              <span className="text-xs text-muted-foreground">
                Stays in the Advanced form under its own name.
              </span>
            </span>
          </SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>
            Inputs: what does this input control in the output?
            {canBeInput ? null : (
              <span className="block text-destructive/80">
                Only file/URL fields can be inputs.
              </span>
            )}
          </SelectLabel>
          {ROLE_ORDER.map((role) => {
            const meta = ROLE_META[role]
            return (
              <SelectItem
                key={role}
                value={`input:${role}`}
                disabled={!canBeInput}
              >
                <HugeiconsIcon icon={meta.icon} aria-hidden />
                <span className="flex flex-col whitespace-normal">
                  <span>
                    {meta.label}
                    {role === "reference" ? (
                      <span className="text-muted-foreground">
                        {" "}
                        (when unsure)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {meta.description}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Controls: a setting in the bar</SelectLabel>
          {CONTROL_NAMES.map((name) => {
            const other = usedBy.get(name)
            const elsewhere = other !== undefined && other !== row.field
            return (
              <SelectItem key={name} value={`control:${name}`}>
                <span className="flex flex-col whitespace-normal">
                  <span>
                    {CONTROL_META[name].label}
                    {elsewhere ? (
                      <span className="text-muted-foreground">
                        {" "}
                        (used by {other})
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CONTROL_META[name].description}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function InputDetails({
  row,
  target,
  onChange,
}: {
  row: FieldRow
  target: Extract<RowTarget, { kind: "input" }>
  onChange: (input: MappingInput) => void
}) {
  const { input } = target
  const requiredId = useId()
  const set = (patch: Partial<MappingInput>) => {
    const next: MappingInput = { ...input, ...patch }
    for (const key of Object.keys(patch) as (keyof MappingInput)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    onChange(next)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={input.kind}
        onValueChange={(next) => {
          if (typeof next === "string") {
            set({ kind: next as MappingInput["kind"] })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Kind for ${row.field}`}
          className="w-28"
        >
          <SelectValue>
            {(value: unknown) =>
              KIND_META[value as MappingInput["kind"]]?.label ?? "Kind"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              <HugeiconsIcon icon={KIND_META[kind].icon} aria-hidden />
              {KIND_META[kind].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {row.isArray ? (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Max
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label={`Max for ${row.field}`}
            placeholder="any"
            className="h-8 w-16"
            value={input.max ?? ""}
            onChange={(event) => {
              const text = event.target.value
              set({ max: text === "" ? undefined : Number(text) })
            }}
          />
        </label>
      ) : null}

      <span className="flex items-center gap-1.5">
        <Switch
          id={requiredId}
          size="sm"
          checked={input.required === true}
          onCheckedChange={(checked) =>
            set({ required: checked ? true : undefined })
          }
        />
        <Label
          htmlFor={requiredId}
          className="text-xs font-normal text-muted-foreground"
        >
          Required <span className="sr-only">for {row.field}</span>
        </Label>
      </span>

      <Input
        aria-label={`Label for ${row.field}`}
        placeholder={`Label (${roleMeta(target.key).label})`}
        maxLength={80}
        className="h-8 min-w-36 flex-1"
        value={input.label ?? ""}
        onChange={(event) =>
          set({
            label: event.target.value === "" ? undefined : event.target.value,
          })
        }
      />

      {SHAPE_NAMES.length > 0 && (row.isArray || !row.isUri) ? (
        <Select
          value={input.shape ?? "none"}
          onValueChange={(next) => {
            if (typeof next === "string") {
              set({ shape: next === "none" ? undefined : next })
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Shape for ${row.field}`}
            className="w-36"
          >
            <SelectValue>
              {(value: unknown) =>
                value === "none" ? "No shape" : `Shape: ${String(value)}`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No shape (plain URLs)</SelectItem>
            {SHAPE_NAMES.map((shape) => (
              <SelectItem key={shape} value={shape}>
                {shape}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

function SuggestionCell({
  row,
  onApply,
}: {
  row: FieldRow
  onApply: () => void
}) {
  const suggestion = row.suggestion
  if (!suggestion) return null
  const style = CONFIDENCE[suggestion.confidence]
  const same = sameTarget(row.target, suggestion.target)

  if (same) {
    if (suggestion.target.kind === "advanced") return null
    return (
      <Badge
        variant={style.variant}
        title={suggestion.why}
        className={cn("font-normal", style.className)}
      >
        <HugeiconsIcon
          icon={SparklesIcon}
          data-icon="inline-start"
          aria-hidden
        />
        Suggested · {style.label}
        <span className="sr-only">. {suggestion.why}</span>
      </Badge>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className={cn(
              "h-auto max-w-full border py-0.5 font-normal whitespace-normal",
              style.variant === "default" ? "border-primary" : "",
              style.className
            )}
            onClick={onApply}
          />
        }
      >
        Suggested: {targetLabel(suggestion.target)} · {style.label}
        <span className="sr-only">. {suggestion.why}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{suggestion.why}</TooltipContent>
    </Tooltip>
  )
}

function Row({
  row,
  index,
  usedBy,
  issues,
  dispatch,
}: {
  row: FieldRow
  index: number
  usedBy: Map<ControlName, string>
  issues: EditorIssue[]
  dispatch: Dispatch<EditorAction>
}) {
  const issueId = useId()
  const detailsId = useId()
  const description = describeField(row)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const setTarget = (target: RowTarget) =>
    dispatch({ type: "setTarget", index, field: row.field, target })
  const { target } = row

  return (
    <tr
      aria-label={row.field}
      data-field={row.field}
      className={cn(
        "flex flex-col gap-2 border-b py-3 last:border-b-0 md:table-row",
        issues.length > 0 && "bg-destructive/5"
      )}
    >
      <td className="min-w-0 md:w-[28%] md:py-3 md:pr-3 md:pl-1 md:align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-medium break-all">
            {row.field}
          </span>
          <Badge
            variant={row.missing ? "destructive" : "secondary"}
            className="font-mono font-normal"
          >
            {typeLabel(row)}
          </Badge>
          {row.required ? (
            <span className="text-xs text-muted-foreground">required</span>
          ) : null}
        </div>
        {description ? (
          <p
            className={cn(
              "mt-1 text-xs text-muted-foreground",
              !descriptionOpen && "line-clamp-2"
            )}
          >
            {description}
          </p>
        ) : null}
        {description && description.length > LONG_DESCRIPTION ? (
          <button
            type="button"
            className="rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={descriptionOpen}
            onClick={() => setDescriptionOpen((on) => !on)}
          >
            {descriptionOpen ? "Less" : "More"}
            <span className="sr-only"> about {row.field}</span>
          </button>
        ) : null}
      </td>
      <td className="md:w-56 md:py-3 md:pr-3 md:align-top">
        <MapsToSelect
          row={row}
          usedBy={usedBy}
          invalid={issues.length > 0}
          describedBy={issues.length > 0 ? issueId : undefined}
          onChange={setTarget}
        />
        {issues.length > 0 ? (
          <ul id={issueId} className="mt-1.5 flex flex-col gap-0.5">
            {issues.map((issue) => (
              <li
                key={`${issue.path}:${issue.message}`}
                className="text-xs text-destructive"
              >
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="min-w-0 md:py-3 md:pr-3 md:align-top">
        {target.kind === "input" ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-expanded={detailsOpen || issues.length > 0}
              aria-controls={detailsId}
              aria-label={`Details for ${row.field}: ${inputSummary(target.input)}`}
              className="h-auto justify-start py-0.5 font-normal text-muted-foreground"
              onClick={() => setDetailsOpen((on) => !on)}
            >
              {inputSummary(target.input)}
              <span aria-hidden className="text-foreground">
                {detailsOpen || issues.length > 0 ? "Hide" : "Edit"}
              </span>
            </Button>
            {detailsOpen || issues.length > 0 ? (
              <div id={detailsId}>
                <InputDetails
                  row={row}
                  target={target}
                  onChange={(input) => setTarget({ ...target, input })}
                />
              </div>
            ) : null}
          </div>
        ) : target.kind === "control" ? (
          enumOf(row.schema) || CONTROL_META[target.control].vocabulary ? (
            target.control === "count" ? null : (
              <ValueMapEditor
                field={row.field}
                control={target.control}
                schema={row.schema}
                values={target.values}
                onChange={(values) =>
                  setTarget(
                    values === undefined
                      ? { kind: "control", control: target.control }
                      : { kind: "control", control: target.control, values }
                  )
                }
              />
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              Sent as it is.
            </span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            Shown under Advanced.
          </span>
        )}
      </td>
      <td className="md:w-40 md:py-3 md:align-top">
        <SuggestionCell
          row={row}
          onApply={() =>
            dispatch({ type: "applySuggestion", index, field: row.field })
          }
        />
      </td>
    </tr>
  )
}

export function FieldMappingTable({
  endpoint,
  index,
  issues,
  dispatch,
}: FieldMappingTableProps) {
  const [filter, setFilter] = useState<RowFilter>("all")
  const [query, setQuery] = useState("")
  const mine = issues.filter(
    (issue) => issue.where !== "family" && issue.where.endpoint === index
  )
  const loose = mine.filter(
    (issue) => issue.where !== "family" && issue.where.field === undefined
  )
  const usedBy = new Map<ControlName, string>()
  for (const row of endpoint.rows) {
    if (row.target.kind === "control") usedBy.set(row.target.control, row.field)
  }
  const broken = new Set(
    mine.flatMap((issue) =>
      issue.where !== "family" && issue.where.field !== undefined
        ? [issue.where.field]
        : []
    )
  )
  const needle = query.trim().toLowerCase()
  const visible = endpoint.rows.filter((row) => {
    if (needle) {
      const text = `${row.field} ${describeField(row) ?? ""}`.toLowerCase()
      if (!text.includes(needle)) return false
    }
    switch (filter) {
      case "all":
        return true
      case "mapped":
        return row.target.kind !== "advanced"
      case "inputs":
        return row.target.kind === "input" || row.isUri
      case "problems":
        return broken.has(row.field)
    }
  })

  /** Runs a bulk change, with a toast that can put the rows back. */
  function bulk(action: EditorAction, done: string) {
    const { uid, rows } = endpoint
    dispatch(action)
    toast.success(done, {
      action: {
        label: "Undo",
        onClick: () => dispatch({ type: "restoreRows", uid, rows }),
      },
    })
  }
  const where = `${PROVIDER_NAMES[endpoint.provider]} ${endpoint.model}`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Show fields"
          className="flex flex-wrap items-center gap-1"
        >
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              aria-pressed={filter === option.value}
              variant={filter === option.value ? "secondary" : "ghost"}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value === "problems" ? (
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    broken.size > 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {broken.size}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              bulk(
                { type: "applyAllSuggestions", index },
                "Applied the suggestions to every row you haven't changed"
              )
            }
          >
            <HugeiconsIcon icon={SparklesIcon} data-icon="inline-start" />
            Apply all suggestions
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              bulk(
                { type: "resetEndpoint", index },
                "Reset every row to its pre-fill"
              )
            }
          >
            <HugeiconsIcon
              icon={ArrowTurnBackwardIcon}
              data-icon="inline-start"
            />
            Reset endpoint
          </Button>
        </div>
      </div>

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search fields"
          placeholder="Search fields and descriptions"
          className="h-8 pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault()
              event.stopPropagation()
              setQuery("")
            }
          }}
        />
      </div>

      {loose.length > 0 ? (
        <ul className="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          {loose.map((issue) => (
            <li
              key={`${issue.path}:${issue.message}`}
              className="text-xs text-destructive"
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <table aria-label={`Fields of ${where}`} className="w-full text-sm">
        <thead className="hidden border-b text-left text-xs text-muted-foreground md:table-header-group">
          <tr>
            <th scope="col" className="py-2 pl-1 font-normal">
              Field
            </th>
            <th scope="col" className="py-2 font-normal">
              Maps to
            </th>
            <th scope="col" className="py-2 font-normal">
              Details
            </th>
            <th scope="col" className="py-2 font-normal">
              Suggestion
            </th>
          </tr>
        </thead>
        <tbody className="flex flex-col md:table-row-group">
          {visible.map((row) => (
            <Row
              key={row.field}
              row={row}
              index={index}
              usedBy={usedBy}
              issues={mine.filter(
                (issue) =>
                  issue.where !== "family" && issue.where.field === row.field
              )}
              dispatch={dispatch}
            />
          ))}
        </tbody>
      </table>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {endpoint.rows.length === 0
            ? "This model's schema has no fields."
            : "No fields match. Clear the search or pick another filter."}
        </p>
      ) : null}
    </div>
  )
}
