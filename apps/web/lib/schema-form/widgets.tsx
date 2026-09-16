"use client"

/**
 * The plain controls the creation bar uses for a model's promoted settings.
 *
 * Deliberately *not* rjsf: these six fields are the ones the user touches on
 * every run, so they get hand-built shadcn controls that sit inline in the bar
 * rather than a generated form row. Everything else in the schema goes to the
 * Advanced sheet, which *is* rjsf.
 *
 * The widget is chosen from the schema's own shape — an enum becomes a Select,
 * a bounded number a Slider paired with a number box, a boolean a Switch — and
 * never from the field's name. A model that calls its resolution `size` still
 * gets a Select, because its schema says `enum`.
 */
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"

import {
  enumOptions,
  isBooleanSchema,
  isNumberSchema,
  numericRange,
  type CommonField,
} from "./split-schema"

export interface CommonFieldControlProps {
  field: CommonField
  value: unknown
  onChange: (value: unknown) => void
}

function description(field: CommonField): string | undefined {
  const text = field.schema.description
  return typeof text === "string" && text.trim() !== "" ? text : undefined
}

/** One promoted setting, laid out as a labelled row. */
export function CommonFieldControl({
  field,
  value,
  onChange,
}: CommonFieldControlProps) {
  const id = `common-${field.field}`
  const hint = description(field)
  const options = enumOptions(field.schema)
  const range = numericRange(field.schema)

  if (isBooleanSchema(field.schema)) {
    return (
      <div className="flex items-start justify-between gap-4 py-1.5">
        <div className="min-w-0">
          <Label htmlFor={id}>{field.label}</Label>
          {hint ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    )
  }

  if (options.length > 0) {
    return (
      <div className="py-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Select
          value={typeof value === "string" ? value : null}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger id={id} className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    )
  }

  if (isNumberSchema(field.schema)) {
    const numeric = typeof value === "number" ? value : null
    return (
      <div className="py-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id}>{field.label}</Label>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            value={numeric ?? ""}
            min={range?.min}
            max={range?.max}
            step={range?.step}
            onChange={(event) => {
              const next = event.target.value
              onChange(next === "" ? undefined : Number(next))
            }}
            className="h-8 w-24 font-mono tabular-nums"
          />
        </div>
        {range ? (
          <Slider
            aria-label={`${field.label} slider`}
            className="mt-2"
            min={range.min}
            max={range.max}
            step={range.step}
            value={numeric ?? range.min}
            onValueChange={(next) =>
              onChange(Array.isArray(next) ? next[0] : next)
            }
          />
        ) : null}
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="py-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
        className="mt-1"
      />
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
