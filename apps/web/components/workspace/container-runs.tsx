"use client"

import { useMemo } from "react"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useGenerations } from "@/hooks/use-generations"
import { useJobs } from "@/hooks/use-jobs"
import { containerRunTiles } from "@/lib/workspace/container-page"
import { groupByDay } from "@/lib/workspace/home"

import { EmptySection } from "./container-card"
import { DayGroup, TileGrid } from "./grids"
import { useRunDetails } from "./home"

/** The newest runs a container's tab shows. */
const LIMIT = 200

/**
 * A container's Generations tab: its own runs, grouped by day, with anything
 * of its own still running on top — which is where a run from the generate
 * panel appears the moment it is queued.
 *
 * Tiles open the read-only details sheet; nothing here can start a run.
 */
export function ContainerRuns({
  containerId,
  empty,
}: {
  containerId: string
  /** What to offer when there are no runs yet — the page's Generate. */
  empty?: React.ReactNode
}) {
  const generations = useGenerations(containerId, { limit: LIMIT })
  const jobs = useJobs()
  const details = useRunDetails()

  const tiles = useMemo(
    () =>
      containerRunTiles({
        containerId,
        jobs: jobs.data ?? [],
        generations: generations.data?.items ?? [],
        outputs: generations.data?.outputs ?? [],
      }),
    [containerId, jobs.data, generations.data]
  )
  const running = tiles.filter((tile) => tile.running)
  const days = useMemo(
    () =>
      groupByDay(
        tiles
          .filter((tile) => !tile.running)
          .map((tile) => ({ ...tile, createdAt: tile.generation.createdAt }))
      ),
    [tiles]
  )

  if (generations.isPending) {
    return (
      <div className="grid grid-cols-3 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="aspect-[4/5] rounded-lg" />
        ))}
      </div>
    )
  }
  if (generations.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {generations.error.message}
      </p>
    )
  }
  if (tiles.length === 0) {
    return (
      <EmptySection
        title="Nothing generated here yet"
        body="Runs filed under this container show up here, newest first."
        action={empty}
      />
    )
  }

  const total = generations.data.total
  return (
    <div className="flex flex-col gap-8">
      {running.length > 0 ? (
        <DayGroup label="Running">
          <TileGrid tiles={running} onOpen={details.open} />
        </DayGroup>
      ) : null}
      {days.map((day) => (
        <DayGroup key={day.label} label={day.label}>
          <TileGrid tiles={day.items} onOpen={details.open} />
        </DayGroup>
      ))}
      {total > LIMIT ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the newest {LIMIT} of {total}. The rest are on the Generations
          page.
        </p>
      ) : null}
      {details.panel}
    </div>
  )
}
