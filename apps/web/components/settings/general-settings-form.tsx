"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import {
  useChooseProjectRoot,
  useSettings,
  useUpdateSettings,
} from "@/lib/settings"

/** Clamps a numeric field to the contract's range before it is sent. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface NumberSettingProps {
  id: string
  label: string
  description: string
  min: number
  max: number
  step?: number
  /** The persisted value, or `undefined` while settings are still loading. */
  value: number | undefined
  fallback: number
  disabled?: boolean
  onCommit: (value: number) => void
}

/**
 * A number field that keeps its own draft string while the user types and only
 * persists on blur or Enter. Editing character-by-character would otherwise
 * write a half-typed number (and an empty field would clamp to the minimum).
 * An empty or unparseable draft is discarded and the persisted value restored.
 */
function NumberSetting({
  id,
  label,
  description,
  min,
  max,
  step,
  value,
  fallback,
  disabled,
  onCommit,
}: NumberSettingProps) {
  const persisted = value ?? fallback
  const [draft, setDraft] = useState(String(persisted))
  const [syncedFrom, setSyncedFrom] = useState(persisted)

  // Adopt the persisted value whenever it changes underneath us (React's
  // "adjust state during render" pattern — no effect, no cascading render).
  if (syncedFrom !== persisted) {
    setSyncedFrom(persisted)
    setDraft(String(persisted))
  }

  function commit() {
    const parsed = Number(draft.trim())
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(persisted))
      return
    }
    const next = clamp(Math.round(parsed), min, max)
    setDraft(String(next))
    if (next !== persisted) onCommit(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        className="w-32"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            setDraft(String(persisted))
          }
        }}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

export function GeneralSettingsForm() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const choose = useChooseProjectRoot()

  const data = settings.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          Where OpenDirect keeps your projects, and how hard it works the
          providers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-root">Project folder</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="project-root"
              readOnly
              className="min-w-64 flex-1 font-mono text-xs"
              placeholder="Not chosen yet"
              value={data?.projectRoot ?? ""}
            />
            <Button
              variant="outline"
              disabled={choose.isPending || update.isPending}
              onClick={() => {
                choose.mutate(undefined, {
                  onSuccess: ({ path }) => {
                    if (path) update.mutate({ projectRoot: path })
                  },
                })
              }}
            >
              Choose…
            </Button>
          </div>
        </div>

        <NumberSetting
          id="max-concurrent-jobs"
          label="Concurrent jobs"
          description="How many generations run at once. Between 1 and 8."
          min={1}
          max={8}
          value={data?.maxConcurrentJobs}
          fallback={2}
          disabled={!data}
          onCommit={(maxConcurrentJobs) => update.mutate({ maxConcurrentJobs })}
        />

        <NumberSetting
          id="poll-interval"
          label="Poll interval (ms)"
          description="How often a running job is checked for progress."
          min={500}
          max={60_000}
          step={500}
          value={data?.pollIntervalMs}
          fallback={3000}
          disabled={!data}
          onCommit={(pollIntervalMs) => update.mutate({ pollIntervalMs })}
        />

        {settings.isError ? (
          <p className="text-xs text-destructive">{settings.error.message}</p>
        ) : null}
        {update.isError ? (
          <p className="text-xs text-destructive">{update.error.message}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
