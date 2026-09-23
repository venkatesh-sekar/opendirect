"use client"

import { useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useContainerSummaries, useContainerTree } from "@/hooks/use-containers"
import { useProjectGenerationPages } from "@/hooks/use-generations"
import { isJobActive, useJobs } from "@/hooks/use-jobs"
import {
  containerCards,
  continueTiles,
  groupByDay,
  type RunTile,
} from "@/lib/workspace/home"

import { EmptySection } from "./container-card"
import {
  CharacterGrid,
  OpenCanvasButton,
  SceneGrid,
  useRunDetails,
} from "./home"
import { NewContainerDialog } from "./new-container"
import { RunTileView } from "./run-tile"
import { WorkspacePage } from "./workspace-page"

/** A page title with its count dimmed after it: "Characters 6". */
function Counted({ title, count }: { title: string; count?: number }) {
  return (
    <>
      {title}
      {count !== undefined ? (
        <span className="ml-1.5 font-normal text-muted-foreground">
          {count}
        </span>
      ) : null}
    </>
  )
}

function ContainerGridScreen({ kind }: { kind: "character" | "scene" }) {
  const tree = useContainerTree()
  const summaries = useContainerSummaries()
  const [creating, setCreating] = useState(false)
  const cards = useMemo(
    () => containerCards(tree.data ?? [], summaries.data, kind),
    [tree.data, summaries.data, kind]
  )
  const title = kind === "character" ? "Characters" : "Scenes"
  const Grid = kind === "character" ? CharacterGrid : SceneGrid

  return (
    <WorkspacePage
      title={
        <Counted title={title} count={tree.data ? cards.length : undefined} />
      }
      actions={
        <>
          <OpenCanvasButton />
          <Button size="sm" onClick={() => setCreating(true)}>
            New {kind}
          </Button>
        </>
      }
    >
      <Grid
        cards={tree.isPending ? null : cards}
        onCreate={() => setCreating(true)}
      />
      {creating ? (
        <NewContainerDialog kind={kind} onClose={() => setCreating(false)} />
      ) : null}
    </WorkspacePage>
  )
}

/** `/characters/` — every character in the project, wherever it is filed. */
export function CharactersScreen() {
  return <ContainerGridScreen kind="character" />
}

/** `/scenes/` — every scene in the project. */
export function ScenesScreen() {
  return <ContainerGridScreen kind="scene" />
}

/** How many runs a page of `/generations/` adds. */
const PAGE = 60

function TileGrid({
  tiles,
  onOpen,
}: {
  tiles: RunTile[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tile) => (
        <RunTileView
          key={tile.generation.id}
          tile={tile}
          onOpen={onOpen}
          fluid
        />
      ))}
    </div>
  )
}

function DayGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      {children}
    </section>
  )
}

/**
 * `/generations/` — every run in the project, newest first, grouped by day,
 * with anything still running on top.
 *
 * "Show more" fetches the next page by offset. Runs are de-duplicated as the
 * pages are joined: the list is newest first, so a run submitted while you
 * scroll pushes the last run of one page onto the top of the next.
 */
export function GenerationsScreen() {
  const generations = useProjectGenerationPages(PAGE)
  const pages = generations.data?.pages
  const joined = useMemo(() => {
    const seen = new Set<string>()
    const items = (pages ?? [])
      .flatMap((page) => page.items)
      .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
    return {
      items,
      outputs: (pages ?? []).flatMap((page) => page.outputs),
      total: pages?.[0]?.total,
    }
  }, [pages])
  const jobs = useJobs()
  const details = useRunDetails()

  const tiles = useMemo(
    () =>
      continueTiles({
        jobs: jobs.data ?? [],
        generations: joined.items,
        outputs: joined.outputs,
      }),
    [jobs.data, joined]
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
  const activeCount = (jobs.data ?? []).filter(isJobActive).length
  const total = joined.total

  return (
    <WorkspacePage
      title={<Counted title="Generations" count={total} />}
      actions={<OpenCanvasButton />}
    >
      {generations.isPending ? (
        <div className="grid grid-cols-3 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : generations.error ? (
        <p role="alert" className="text-sm text-destructive">
          {generations.error.message}
        </p>
      ) : tiles.length === 0 ? (
        <EmptySection
          title="Nothing generated yet"
          body="Runs you start on the canvas show up here, newest first."
          action={<OpenCanvasButton />}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {activeCount > 0 ? (
            <DayGroup label="Running">
              <TileGrid tiles={running} onOpen={details.open} />
            </DayGroup>
          ) : null}
          {days.map((day) => (
            <DayGroup key={day.label} label={day.label}>
              <TileGrid tiles={day.items} onOpen={details.open} />
            </DayGroup>
          ))}
          {generations.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              disabled={generations.isFetchingNextPage}
              onClick={() => void generations.fetchNextPage()}
            >
              {generations.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          ) : null}
        </div>
      )}
      {details.panel}
    </WorkspacePage>
  )
}
