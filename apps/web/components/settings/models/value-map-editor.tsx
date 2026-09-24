"use client"

/**
 * The value map of one control (design §3): canonical value → provider
 * value, so the canvas offers one vocabulary ("16:9", "5") whatever the
 * provider calls it ("landscape", 5).
 *
 * No map at all is the default and means identity: the canonical value is
 * sent as it is. A map, once there, is also the list of values the control
 * offers — translation refuses a value the map does not name — so "Start
 * from the field's values" writes the field's own enum as identity pairs to
 * edit from, rather than leaving the person to retype it.
 *
 * Provider values are typed by the field's schema: picked from its enum, or
 * typed and coerced (a number field gets a number).
 */
import { useId, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import type { ControlName } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
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

import { CONTROL_META } from "@/lib/registry/control-meta"
import type { ControlValues } from "@/lib/registry/editor-state"

type Scalar = string | number | boolean

/** Common canonical values per control, offered as suggestions. */
const VOCABULARY: Partial<Record<ControlName, string[]>> = {
  aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
  duration: ["4", "5", "6", "8", "10"],
  resolution: ["480p", "720p", "1080p"],
  generate_audio: ["true", "false"],
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

/** The field's enum, when it has one of scalars. */
export function enumOf(schema: Record<string, unknown>): Scalar[] | null {
  const values = schema.enum
  if (!Array.isArray(values)) return null
  const scalars = values.filter(isScalar)
  return scalars.length > 0 ? scalars : null
}

/** Typed text → the schema's type; text that does not fit stays text. */
function coerce(text: string, schema: Record<string, unknown>): Scalar {
  const type = schema.type
  if ((type === "integer" || type === "number") && text.trim() !== "") {
    const number = Number(text)
    if (Number.isFinite(number)) return number
  }
  if (type === "boolean" && (text === "true" || text === "false")) {
    return text === "true"
  }
  return text
}

interface Pair {
  canonical: string
  provider: Scalar | null
}

function toPairs(values: ControlValues | undefined): Pair[] {
  return Object.entries(values ?? {}).map(([canonical, provider]) => ({
    canonical,
    provider,
  }))
}

function toValues(pairs: Pair[]): ControlValues | undefined {
  const out: ControlValues = {}
  for (const pair of pairs) {
    const canonical = pair.canonical.trim()
    // A repeated canonical value: the first one stands, as the row says.
    if (canonical === "" || pair.provider === null || canonical in out) continue
    out[canonical] = pair.provider
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export interface ValueMapEditorProps {
  field: string
  control: ControlName
  schema: Record<string, unknown>
  values: ControlValues | undefined
  onChange: (values: ControlValues | undefined) => void
}

function ValueMapBody({
  field,
  control,
  schema,
  values,
  onChange,
}: ValueMapEditorProps) {
  const [pairs, setPairs] = useState<Pair[]>(() => toPairs(values))
  const options = enumOf(schema)
  const listId = useId()
  const vocabulary = VOCABULARY[control] ?? []

  function commit(next: Pair[]) {
    setPairs(next)
    onChange(toValues(next))
  }

  function update(index: number, patch: Partial<Pair>) {
    commit(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)))
  }

  const seen = new Map<string, number>()
  pairs.forEach((pair, index) => {
    const key = pair.canonical.trim()
    if (key && !seen.has(key)) seen.set(key, index)
  })

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">
          {CONTROL_META[control].label} values
        </p>
        <p className="text-xs text-muted-foreground">
          What the canvas offers, and what{" "}
          <span className="font-mono">{field}</span> receives. With no values,
          each value is sent as it is.
        </p>
      </div>

      {pairs.length > 0 ? (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-1 text-left font-normal">Canonical</th>
              <th className="pb-1 text-left font-normal">
                Sent as <span className="font-mono">{field}</span>
              </th>
              <th className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, index) => {
              const duplicate =
                pair.canonical.trim() !== "" &&
                seen.get(pair.canonical.trim()) !== index
              // Half a pair is kept here, never silently dropped, and says
              // what it still needs.
              const incomplete =
                pair.canonical.trim() !== "" && pair.provider === null
                  ? "Pick what to send. This value isn't saved until then."
                  : pair.canonical.trim() === "" && pair.provider !== null
                    ? "Name the canonical value. This row isn't saved until then."
                    : null
              return (
                <tr key={index} className="align-top">
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Canonical value ${index + 1}`}
                      aria-invalid={duplicate || undefined}
                      list={vocabulary.length > 0 ? listId : undefined}
                      className="h-8"
                      value={pair.canonical}
                      onChange={(event) =>
                        update(index, { canonical: event.target.value })
                      }
                    />
                    {duplicate ? (
                      <p className="mt-1 text-destructive">
                        Already listed above; the first one is used.
                      </p>
                    ) : null}
                    {incomplete ? (
                      <p className="mt-1 text-destructive">{incomplete}</p>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2">
                    {options ? (
                      <Select
                        value={
                          pair.provider === null
                            ? null
                            : JSON.stringify(pair.provider)
                        }
                        onValueChange={(next) => {
                          if (typeof next !== "string") return
                          update(index, {
                            provider: JSON.parse(next) as Scalar,
                          })
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Provider value ${index + 1}`}
                          className="w-full"
                        >
                          <SelectValue placeholder="Pick a value">
                            {(value: unknown) =>
                              typeof value === "string"
                                ? String(JSON.parse(value))
                                : "Pick a value"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((option) => (
                            <SelectItem
                              key={JSON.stringify(option)}
                              value={JSON.stringify(option)}
                            >
                              {String(option)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        aria-label={`Provider value ${index + 1}`}
                        className="h-8 font-mono"
                        value={
                          pair.provider === null ? "" : String(pair.provider)
                        }
                        onChange={(event) =>
                          update(index, {
                            provider:
                              event.target.value === ""
                                ? null
                                : coerce(event.target.value, schema),
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="py-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove value ${index + 1}`}
                      onClick={() =>
                        commit(pairs.filter((_, i) => i !== index))
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Identity: every value passes through unchanged.
        </p>
      )}

      {vocabulary.length > 0 ? (
        <datalist id={listId}>
          {vocabulary.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setPairs([...pairs, { canonical: "", provider: null }])
          }
        >
          <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
          Add value
        </Button>
        {options ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              commit(
                options.map((option) => ({
                  canonical: String(option),
                  provider: option,
                }))
              )
            }
          >
            Start from the field&apos;s values
          </Button>
        ) : null}
        {pairs.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => commit([])}>
            Clear (identity)
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** The "Values…" button of a control row and its popover. */
export function ValueMapEditor(props: ValueMapEditorProps) {
  const [open, setOpen] = useState(false)
  const count = Object.keys(props.values ?? {}).length
  const label = CONTROL_META[props.control].label
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            aria-label={`Values for ${label.toLowerCase()}: ${count === 0 ? "identity" : `${count} mapped`}`}
          />
        }
      >
        Values…
        <span className="text-xs text-muted-foreground tabular-nums">
          {count === 0 ? "identity" : count}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[26rem] max-w-[calc(100vw-2rem)]"
        aria-label={`Values for ${label.toLowerCase()}`}
      >
        {open ? <ValueMapBody {...props} /> : null}
      </PopoverContent>
    </Popover>
  )
}
