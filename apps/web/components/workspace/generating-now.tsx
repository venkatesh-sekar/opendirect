"use client"

import { useMemo } from "react"

import { isJobActive, useJobs } from "@/hooks/use-jobs"
import { modelName } from "@/lib/workspace/home"

import { ProgressBar } from "./run-tile"

/**
 * Home's right rail: every run still in flight, with its progress.
 *
 * Read-only on purpose. Cancel, retry and resume live in the job list behind
 * the status strip, where they always have; a second set of those buttons
 * here would be a second place to spend money from.
 */
export function GeneratingNow() {
  const jobs = useJobs()
  const active = useMemo(
    () => (jobs.data ?? []).filter(isJobActive),
    [jobs.data]
  )

  return (
    <aside
      aria-labelledby="generating-now"
      className="hidden w-80 shrink-0 flex-col gap-2.5 overflow-y-auto border-l px-5 py-5.5 lg:flex"
    >
      <h2
        id="generating-now"
        className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        Generating now
      </h2>
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing generating. Runs you start show up here with their progress.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-2 rounded-lg border bg-card p-2.5"
            >
              <div className="flex items-center gap-2.5">
                <div className="size-9 shrink-0 rounded-md bg-muted opacity-60" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs">
                    {job.generation.prompt || "No prompt"}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {modelName(job.generation.modelSlug)}
                  </span>
                </div>
                <span className="ml-auto font-mono text-[11px] text-status-running">
                  {job.progress !== null
                    ? `${Math.round(job.progress * 100)}%`
                    : job.state === "queued"
                      ? "Queued"
                      : "…"}
                </span>
              </div>
              <ProgressBar progress={job.progress} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
