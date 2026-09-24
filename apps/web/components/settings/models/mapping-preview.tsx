"use client"

/**
 * "On the canvas": the draft mapping as a node will show it, live (plan
 * Task 9). The slots are `familySlots` of the draft drawn with `SlotChip` —
 * exactly what the canvas uses — so what is previewed is what appears.
 *
 * Below the slots: the controls the bar gains, and where the family runs,
 * each endpoint with the slots it takes (which inputs combine on one
 * endpoint) and which one is used first under the current provider order
 * and keys. With more than one endpoint, "Try it" marks slots as filled to
 * show the same dimming, and the same reasons, the canvas shows.
 *
 * ⛔ Pure preview: reads settings and the key summary, fetches nothing else.
 */
import { useState, type ReactNode } from "react"
import {
  CONTROL_NAMES,
  PROVIDER_NAMES,
  chooseEndpoint,
  familySlots,
  slotAvailability,
  type ModelFamily,
  type ProviderId,
} from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { CONTROL_META } from "@/lib/registry/control-meta"

import { RoleBadge } from "@/components/models/role-badge"
import { SlotChip } from "@/components/models/slot-chip"

export interface MappingPreviewProps {
  family: ModelFamily
  /** Endpoint index → its input schema, for the loaded ones. */
  schemas: Record<number, unknown>
  providerOrder: readonly ProviderId[]
  /** Providers with a key. */
  configured: readonly ProviderId[]
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

export function MappingPreview({
  family,
  schemas,
  providerOrder,
  configured,
}: MappingPreviewProps) {
  const [filled, setFilled] = useState<string[]>([])

  if (family.endpoints.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
        Add an endpoint to see how this model looks on a canvas node.
      </p>
    )
  }

  const slots = familySlots(family, schemas)
  const keys = new Set(slots.map((slot) => slot.field))
  const active = filled.filter((key) => keys.has(key))
  const input = {
    filled: active,
    providerOrder,
    configured,
    override: null,
  }
  const availability = slotAvailability(family, input)
  const choice = chooseEndpoint(family, input)
  const chosen = choice.ok ? family.endpoints[choice.index] : null
  const controls = CONTROL_NAMES.filter((name) =>
    family.endpoints.some((endpoint) => endpoint.controls[name] !== undefined)
  )

  function toggle(key: string) {
    setFilled((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
    )
  }

  return (
    <div className="flex flex-col gap-4" aria-label="Preview">
      <Section title="Slots">
        {slots.length > 0 ? (
          <ul
            aria-label="Slots on the canvas"
            className="flex flex-wrap gap-1.5"
          >
            {slots.map((slot) => (
              <li key={slot.field} className="max-w-full">
                <SlotChip
                  slot={{
                    ...slot,
                    required:
                      chosen?.inputs[slot.field]?.required === true || false,
                  }}
                  availability={availability[slot.field]}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No inputs mapped: the node takes a prompt and controls only.
          </p>
        )}
      </Section>

      {family.endpoints.length > 1 && slots.length > 0 ? (
        <Section title="Try it: mark slots as filled">
          <div
            role="group"
            aria-label="Filled slots"
            className="flex flex-wrap gap-1"
          >
            {slots.map((slot) => {
              const on = active.includes(slot.field)
              return (
                <Button
                  key={slot.field}
                  type="button"
                  size="xs"
                  variant={on ? "secondary" : "ghost"}
                  aria-pressed={on}
                  className="border"
                  onClick={() => toggle(slot.field)}
                >
                  {slot.label}
                </Button>
              )
            })}
          </div>
          {!choice.ok ? (
            <p className="text-xs text-destructive">{choice.message}</p>
          ) : null}
        </Section>
      ) : null}

      <Section title="Controls in the bar">
        {controls.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {controls.map((name) => (
              <Badge key={name} variant="secondary" className="font-normal">
                {CONTROL_META[name].label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            None mapped; every field stays under Advanced.
          </p>
        )}
      </Section>

      <Section title="Runs on">
        <ol className="flex flex-col gap-2">
          {family.endpoints.map((endpoint, index) => {
            const inputs = Object.keys(endpoint.inputs)
            const first = choice.index === index && choice.ok
            return (
              <li
                key={`${endpoint.provider}:${endpoint.model}:${index}`}
                className="flex flex-col gap-1 rounded-md border p-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">
                    {PROVIDER_NAMES[endpoint.provider]}
                  </Badge>
                  <span className="min-w-0 font-mono text-xs break-all">
                    {endpoint.model}
                  </span>
                  {first ? <Badge className="ml-auto">used first</Badge> : null}
                </div>
                {inputs.length > 0 ? (
                  <div
                    className="flex flex-wrap gap-1"
                    aria-label={`Slots on ${PROVIDER_NAMES[endpoint.provider]} ${endpoint.model}`}
                  >
                    {inputs.map((key) => (
                      <RoleBadge key={key} role={key} />
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Prompt and controls only.
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        {configured.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add a provider key in Settings → Providers to run it.
          </p>
        ) : null}
      </Section>
    </div>
  )
}
