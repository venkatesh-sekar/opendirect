"use client"

/**
 * The job list: a Sheet opened from the status strip.
 *
 * It is a sheet rather than a panel because the queue is something you check,
 * not something you watch — the board stays the hero, and the trigger carries
 * the only number that matters when the sheet is closed: how many runs are
 * still going.
 *
 * Nothing here polls. `useJobs` subscribes to main's `jobs:update` pushes, so
 * the rows move as the runner moves them, and the board's queries are
 * invalidated by the same subscription when a run finishes.
 */
import { useEffect, useState } from "react"
import type { JobDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"

import {
  isJobActive,
  useCancelJob,
  useJobs,
  useResumeJob,
  useRetryJob,
} from "@/hooks/use-jobs"

import { JobRow } from "./job-row"

/** Re-renders the elapsed times, but only while something is actually running. */
function useTicker(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

export function JobList() {
  const jobs = useJobs()
  const cancel = useCancelJob()
  const retry = useRetryJob()
  const resume = useResumeJob()

  const items: JobDto[] = jobs.data ?? []
  const active = items.filter(isJobActive)
  const held = items.filter((job) => job.awaitingResume)
  const now = useTicker(active.length > 0)

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2">
            <span>Jobs</span>
            <span
              className="font-mono text-xs text-muted-foreground"
              data-testid="active-job-count"
            >
              {active.length}
            </span>
          </Button>
        }
      />
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Jobs</SheetTitle>
          <SheetDescription>
            {active.length === 0
              ? "Nothing is running."
              : `${active.length} run${active.length === 1 ? "" : "s"} in progress.`}
            {held.length > 0
              ? ` ${held.length} waiting for you to resume ${held.length === 1 ? "it" : "them"}.`
              : ""}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Runs you start appear here, with their cost and their outputs.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                now={now}
                busy={cancel.isPending || retry.isPending || resume.isPending}
                onCancel={(target) => cancel.mutate(target.id)}
                onRetry={(target) => retry.mutate(target.id)}
                onResume={(target) => resume.mutate(target.id)}
              />
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}
