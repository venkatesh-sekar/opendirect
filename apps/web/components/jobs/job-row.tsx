"use client"

/**
 * One run in the job list.
 *
 * It answers four questions in the order they are asked: what is it, how is it
 * going, what did it cost, and what can I do about it. The model and the board
 * it lands on are the identity; the state and the elapsed time are the
 * progress; the price is set in the mono face because it is data; and Cancel or
 * Retry sits at the end because it is the last thing you decide.
 *
 * A failed run shows its provider error inline rather than behind a tooltip —
 * "Failed" with no reason is the least useful thing a job list can say.
 */
import type { GenerationDto, JobDto, JobState } from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { formatUsd } from "@/lib/price"

/** State → what the badge says and how loudly it says it. */
const STATE_LABELS: Record<JobState, string> = {
  queued: "Queued",
  submitting: "Submitting",
  running: "Running",
  downloading: "Downloading",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Cancelled",
}

const STATE_VARIANTS: Record<
  JobState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  submitting: "secondary",
  running: "secondary",
  downloading: "secondary",
  succeeded: "outline",
  failed: "destructive",
  canceled: "outline",
}

const ACTIVE: ReadonlySet<JobState> = new Set([
  "queued",
  "submitting",
  "running",
  "downloading",
])

/**
 * What the run cost, or is expected to.
 *
 * A provider-reported figure is exact and shown plainly; an estimate keeps its
 * `~`; a model with no published rate says so rather than showing `$0.00`.
 */
export function costLabel(generation: GenerationDto): string {
  if (generation.actualCostUsd !== null)
    return formatUsd(generation.actualCostUsd)
  if (generation.estimatedCostUsd !== null)
    return `~${formatUsd(generation.estimatedCostUsd)}`
  return "Cost unknown"
}

/** `m:ss`, or `h:mm:ss` once a run has been going long enough to need it. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = String(total % 60).padStart(2, "0")
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`
}

/** How long the run has been going, or how long it took. */
export function elapsedFor(job: JobDto, now: number): number {
  const started = job.generation.startedAt ?? job.generation.createdAt
  return (job.generation.completedAt ?? now) - started
}

export interface JobRowProps {
  job: JobDto
  now: number
  onCancel: (job: JobDto) => void
  onRetry: (job: JobDto) => void
  onResume: (job: JobDto) => void
  busy?: boolean
}

export function JobRow({
  job,
  now,
  onCancel,
  onRetry,
  onResume,
  busy,
}: JobRowProps) {
  const active = ACTIVE.has(job.state)
  const { generation } = job

  return (
    <li className="flex flex-col gap-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{generation.modelSlug}</p>
          <p className="truncate text-xs text-muted-foreground">
            {generation.prompt ?? "No prompt"}
          </p>
        </div>
        <Badge variant={STATE_VARIANTS[job.state]}>
          {STATE_LABELS[job.state]}
        </Badge>
      </div>

      {active ? (
        <div
          role="progressbar"
          aria-label={`${STATE_LABELS[job.state]} — ${generation.modelSlug}`}
          aria-valuenow={
            job.progress === null ? undefined : Math.round(job.progress * 100)
          }
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary",
              // Neither provider reports a percentage, so an unknown one is
              // shown as a wide indeterminate bar rather than an invented 50%.
              job.progress === null && "w-1/3 animate-pulse"
            )}
            style={
              job.progress === null
                ? undefined
                : { width: `${Math.round(job.progress * 100)}%` }
            }
          />
        </div>
      ) : null}

      {job.state === "failed" && generation.error ? (
        <p className="text-xs text-destructive">{generation.error}</p>
      ) : null}

      {job.awaitingResume ? (
        <p className="text-xs text-muted-foreground">
          This run was still queued when OpenDirect last quit. Nothing has been
          sent to the provider and nothing has been charged — it starts when you
          say so.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span>{formatElapsed(elapsedFor(job, now))}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{costLabel(generation)}</span>
          {job.attempts > 1 ? <span>· attempt {job.attempts}</span> : null}
        </span>

        {job.awaitingResume ? (
          <span className="flex items-center gap-1">
            <Button size="sm" disabled={busy} onClick={() => onResume(job)}>
              Resume
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onCancel(job)}
            >
              Discard
            </Button>
          </span>
        ) : active ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onCancel(job)}
          >
            Cancel
          </Button>
        ) : job.state === "succeeded" ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRetry(job)}
          >
            Retry
          </Button>
        )}
      </div>
    </li>
  )
}
