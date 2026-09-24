"use client"

/**
 * Settings → Models → the registry card (design §4, plan Task 8).
 *
 * Answers "which mappings am I running on, and are they current?" in one
 * line — the version, where it came from (bundled with the app, or a newer
 * copy from GitHub) and when GitHub was last checked — then offers the
 * controls that change that answer: Reload, the switch that allows fetching
 * at all, and the URL to fetch from.
 *
 * Nothing fails silently (design §4): a mapping that was skipped is counted
 * and listed with its reason, and a failed fetch is shown with what stayed
 * in force instead.
 *
 * ⛔ Reload and the remote switch only ever cause free `GET`s of static JSON
 * from GitHub. Nothing here reaches a provider.
 */
import { useEffect, useId, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  Loading03Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import {
  DEFAULT_REGISTRY_URL,
  type RegistryStatus,
  type RegistryWarning,
} from "@opendirect/contract"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { queryKeys } from "@/hooks/query-keys"
import { invalidateModelQueries } from "@/hooks/use-models"
import {
  useRegistryStatus,
  useReloadRegistry,
} from "@/hooks/use-model-registry"
import { useSettings, useUpdateSettings } from "@/lib/settings"

import { FieldError } from "../field-error"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
function checkedAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return "just now"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  const days = Math.floor(elapsed / DAY)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

/** The clock, re-read every 30 s so "checked 3 min ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/**
 * The card's one-line answer: "v12 · from GitHub (remote) · checked 3 min
 * ago", or "v1 · bundled with the app" (plus when GitHub was checked, if it
 * was, so a bundled answer never reads as "never looked").
 */
export function describeRegistry(status: RegistryStatus, now: number): string {
  const parts = [`v${status.activeVersion}`]
  const fetchedAt = status.remote.fetchedAt
  if (status.activeSource === "remote") {
    parts.push("from GitHub (remote)")
    if (fetchedAt !== null) parts.push(`checked ${checkedAgo(fetchedAt, now)}`)
  } else {
    parts.push("bundled with the app")
    if (status.remote.enabled && fetchedAt !== null) {
      parts.push(`GitHub checked ${checkedAgo(fetchedAt, now)}`)
    }
  }
  return parts.join(" · ")
}

const SOURCE_NAMES: Record<RegistryWarning["source"], string> = {
  bundled: "Bundled",
  remote: "GitHub",
  user: "Your mappings",
}

function warningLine(warning: RegistryWarning): string {
  return [SOURCE_NAMES[warning.source], warning.familyId, warning.message]
    .filter((part): part is string => Boolean(part))
    .join(" · ")
}

function SkippedMappings({ warnings }: { warnings: RegistryWarning[] }) {
  const [open, setOpen] = useState(false)
  const count = warnings.length
  return (
    <Alert>
      <HugeiconsIcon icon={Alert02Icon} />
      <AlertTitle>
        {count} {count === 1 ? "mapping was" : "mappings were"} skipped
      </AlertTitle>
      <AlertDescription>
        <p>
          {count === 1 ? "It" : "They"} did not pass validation, so the layer
          underneath stays in force for those models.
        </p>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            render={
              <Button variant="link" size="xs" className="-ml-2 h-auto" />
            }
          >
            {open ? "Hide details" : "Show details"}
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              data-icon="inline-end"
              className={
                open
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul
              aria-label="Skipped mappings"
              className="mt-1 flex flex-col gap-1 font-mono text-xs break-words"
            >
              {warnings.map((warning, index) => (
                <li key={`${warning.source}-${warning.familyId}-${index}`}>
                  {warningLine(warning)}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  )
}

/** Why an https URL is required, in the words the contract uses. */
const HTTPS_ONLY = "The registry URL must start with https://."

function urlProblem(value: string): string | null {
  if (!/^https:\/\//i.test(value)) return HTTPS_ONLY
  try {
    new URL(value)
    return null
  } catch {
    return "That is not a URL. Paste the address of the registry folder."
  }
}

interface RegistryUrlProps {
  persisted: string | null
  disabled: boolean
  onCommit: (url: string | null) => void
}

/**
 * The remote base URL, collapsed by default because almost nobody changes
 * it. Saved on blur or Enter like the General tab; an empty field means the
 * default.
 */
function RegistryUrl({ persisted, disabled, onCommit }: RegistryUrlProps) {
  const [open, setOpen] = useState(persisted !== null)
  const [draft, setDraft] = useState(persisted ?? "")
  const [syncedFrom, setSyncedFrom] = useState(persisted)
  const [problem, setProblem] = useState<string | null>(null)
  const hintId = useId()

  // Adopt the persisted value when it changes underneath us.
  if (syncedFrom !== persisted) {
    setSyncedFrom(persisted)
    setDraft(persisted ?? "")
    setProblem(null)
  }

  function commit() {
    const value = draft.trim()
    if (value === "") {
      setProblem(null)
      if (persisted !== null) onCommit(null)
      return
    }
    const issue = urlProblem(value)
    setProblem(issue)
    if (issue === null && value !== persisted) onCommit(value)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm" className="-ml-2 self-start" />
        }
      >
        Registry URL
        <span className="font-normal text-muted-foreground">
          · {persisted === null ? "default" : "custom"}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          data-icon="inline-end"
          className={
            open ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Registry URL"
              aria-describedby={hintId}
              aria-invalid={problem !== null || undefined}
              type="url"
              inputMode="url"
              spellCheck={false}
              className="min-w-0 flex-1 basis-64 font-mono text-xs"
              placeholder={DEFAULT_REGISTRY_URL}
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commit()
                } else if (
                  event.key === "Escape" &&
                  draft !== (persisted ?? "")
                ) {
                  // Undo the edit first; a second Escape leaves the screen.
                  event.preventDefault()
                  setDraft(persisted ?? "")
                  setProblem(null)
                }
              }}
            />
            {persisted !== null ? (
              <Button
                variant="link"
                size="sm"
                disabled={disabled}
                onClick={() => onCommit(null)}
              >
                Reset
              </Button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            The folder holding <code>index.json</code> and <code>models/</code>.
            Leave it empty to use the OpenDirect repository on GitHub.
          </p>
          <FieldError>{problem}</FieldError>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RegistryStatusCard() {
  const client = useQueryClient()
  const status = useRegistryStatus()
  const reload = useReloadRegistry()
  const settings = useSettings()
  const update = useUpdateSettings()
  const reloadHintId = useId()
  const now = useNow()
  const remoteId = useId()
  const remoteHintId = useId()

  const data = status.data
  // Settings decide the switch; status says what main last saw. Prefer the
  // setting so the switch answers instantly.
  const remoteOn = settings.data?.remoteRegistry ?? data?.remote.enabled ?? true

  /** How a reload went is said once, by the hook's toast, as on every tab. */
  function runReload() {
    reload.mutate()
  }

  /** A remote setting changes what is in force, so the registry is re-read. */
  function saveRemote(patch: {
    remoteRegistry?: boolean
    registryUrl?: string | null
  }) {
    update.mutate(patch, {
      onSuccess: (next) => {
        void client.invalidateQueries({ queryKey: queryKeys.registry.all })
        invalidateModelQueries(client)
        // Turning fetching on, or pointing it somewhere new, is a request
        // to look now — not tomorrow.
        if (next.remoteRegistry) runReload()
      },
    })
  }

  const reloadDisabled = !remoteOn || reload.isPending
  const reloadButton = (
    <Button
      variant="outline"
      size="sm"
      focusableWhenDisabled
      disabled={reloadDisabled}
      aria-describedby={remoteOn ? undefined : reloadHintId}
      onClick={runReload}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      <HugeiconsIcon
        icon={reload.isPending ? Loading03Icon : RefreshIcon}
        data-icon="inline-start"
        className={reload.isPending ? "animate-spin" : undefined}
      />
      {reload.isPending ? "Reloading…" : "Reload registry"}
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model registry</CardTitle>
        <CardDescription>
          {data ? (
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground">
                {describeRegistry(data, now)}
              </span>
              <span className="text-xs">
                {data.families} model{" "}
                {data.families === 1 ? "family" : "families"} mapped
                {data.overrides > 0 ? `, ${data.overrides} of them yours` : ""}.
              </span>
            </span>
          ) : status.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : null}
        </CardDescription>
        <CardAction>
          {/* Always the same tree, so the button keeps focus as it toggles. */}
          <Tooltip disabled={remoteOn}>
            <TooltipTrigger render={reloadButton} />
            <TooltipContent>
              Turn on Fetch updates from GitHub to reload.
            </TooltipContent>
          </Tooltip>
          <span id={reloadHintId} className="sr-only">
            Turn on Fetch updates from GitHub to reload.
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data?.remote.error ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertCircleIcon} />
            <AlertTitle>Could not fetch the remote registry</AlertTitle>
            <AlertDescription>
              <p className="font-mono text-xs break-words">
                {data.remote.error}
              </p>
              <p>
                {data.activeSource === "remote"
                  ? `Using v${data.activeVersion} from the last successful fetch.`
                  : "Using the bundled registry."}
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {data && data.warnings.length > 0 ? (
          <SkippedMappings warnings={data.warnings} />
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={remoteId}>Fetch updates from GitHub</Label>
            <p id={remoteHintId} className="text-xs text-muted-foreground">
              Checks once a day for newer mappings. It only downloads small JSON
              files and never contacts a provider.
            </p>
          </div>
          <Switch
            id={remoteId}
            aria-describedby={remoteHintId}
            checked={remoteOn}
            disabled={!settings.data || update.isPending}
            onCheckedChange={(checked) =>
              saveRemote({ remoteRegistry: checked })
            }
          />
        </div>

        <RegistryUrl
          persisted={settings.data?.registryUrl ?? null}
          disabled={!settings.data}
          onCommit={(registryUrl) => saveRemote({ registryUrl })}
        />

        <FieldError>{status.isError ? status.error.message : null}</FieldError>
        <FieldError>{update.isError ? update.error.message : null}</FieldError>
      </CardContent>
    </Card>
  )
}
