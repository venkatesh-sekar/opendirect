"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, CanvasIcon } from "@hugeicons/core-free-icons"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useContainerSummaries, useContainerTree } from "@/hooks/use-containers"
import { useProjectGenerations } from "@/hooks/use-generations"
import { useJobs } from "@/hooks/use-jobs"
import { canvasHref } from "@/lib/shell/routes"
import { containerCards, continueTiles } from "@/lib/workspace/home"

import { DetailsPanel } from "@/components/board/details-panel"

import {
  CharacterCard,
  EmptySection,
  NewCard,
  SceneCard,
} from "./container-card"
import { GeneratingNow } from "./generating-now"
import { NewContainerDialog, NewMenu, type NewKind } from "./new-container"
import { RunTileView } from "./run-tile"
import { Section, WorkspacePage } from "./workspace-page"

/** How many finished runs the Continue strip fetches. */
const CONTINUE_LIMIT = 12

export function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {label}
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
    </Link>
  )
}

/** The Open canvas button every project page's top bar can carry. */
export function OpenCanvasButton({ focus }: { focus?: string | null }) {
  return (
    <Link
      href={canvasHref(focus)}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <HugeiconsIcon icon={CanvasIcon} className="size-4" />
      Open canvas
    </Link>
  )
}

/**
 * The details sheet for a run opened from a tile.
 *
 * ⛔ Read-only here: "Branch from this run" seeds a canvas node, so it is left
 * to the canvas, and the panel drops the button when no handler is given.
 */
export function useRunDetails() {
  const [openId, setOpenId] = useState<string | null>(null)
  const panel = openId ? (
    <DetailsPanel
      generationId={openId}
      open
      onOpenChange={(open) => (open ? undefined : setOpenId(null))}
    />
  ) : null
  return { open: setOpenId, panel }
}

function StripSkeleton() {
  return (
    <div className="flex gap-3.5">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-42 w-34 shrink-0 rounded-lg" />
      ))}
    </div>
  )
}

/**
 * Home: where opening a project lands.
 *
 * Three sections — Continue, Characters, Scenes — and a rail of what is
 * generating now. Everything here reads; the only writes are creating a
 * container and importing files, and ⛔ nothing on this page can start a paid
 * run. That still takes a Generate click on the canvas.
 */
export function Home() {
  const tree = useContainerTree()
  const summaries = useContainerSummaries()
  const generations = useProjectGenerations({ limit: CONTINUE_LIMIT })
  const jobs = useJobs()
  const details = useRunDetails()
  const [creating, setCreating] = useState<NewKind | null>(null)

  const tiles = useMemo(
    () =>
      continueTiles({
        jobs: jobs.data ?? [],
        generations: generations.data?.items ?? [],
        outputs: generations.data?.outputs ?? [],
      }),
    [jobs.data, generations.data]
  )
  const characters = useMemo(
    () => containerCards(tree.data ?? [], summaries.data, "character"),
    [tree.data, summaries.data]
  )
  const scenes = useMemo(
    () => containerCards(tree.data ?? [], summaries.data, "scene"),
    [tree.data, summaries.data]
  )

  return (
    <WorkspacePage
      title="Home"
      actions={
        <>
          <OpenCanvasButton />
          <NewMenu onCreate={setCreating} />
        </>
      }
      rail={<GeneratingNow />}
    >
      <div className="flex flex-col gap-8">
        <Section
          title="Continue"
          link={<SectionLink href="/generations/" label="All generations" />}
        >
          {generations.isPending ? (
            <StripSkeleton />
          ) : generations.error ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load recent generations: {generations.error.message}
            </p>
          ) : tiles.length === 0 ? (
            <EmptySection
              title="Nothing generated yet"
              body="Runs you start on the canvas show up here, newest first."
              action={<OpenCanvasButton />}
            />
          ) : (
            <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-1">
              {tiles.map((tile) => (
                <RunTileView
                  key={tile.generation.id}
                  tile={tile}
                  onOpen={details.open}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Characters"
          count={tree.data ? characters.length : null}
          link={<SectionLink href="/characters/" label="View all" />}
        >
          <CharacterGrid
            cards={tree.isPending ? null : characters}
            onCreate={() => setCreating("character")}
          />
        </Section>

        <Section
          title="Scenes"
          count={tree.data ? scenes.length : null}
          link={<SectionLink href="/scenes/" label="View all" />}
        >
          <SceneGrid
            cards={tree.isPending ? null : scenes}
            onCreate={() => setCreating("scene")}
          />
        </Section>
      </div>

      {details.panel}
      {creating ? (
        <NewContainerDialog kind={creating} onClose={() => setCreating(null)} />
      ) : null}
    </WorkspacePage>
  )
}

/** Seven 3:4 cards a row, ending in a dashed "New character". */
export function CharacterGrid({
  cards,
  onCreate,
}: {
  cards: ReturnType<typeof containerCards> | null
  onCreate: () => void
}) {
  if (cards === null)
    return <Skeleton className="aspect-[3/4] w-full max-w-40 rounded-lg" />
  if (cards.length === 0)
    return (
      <EmptySection
        title="No characters yet"
        body="A character keeps a face consistent: its references go with every @mention."
        action={
          <Button size="sm" variant="outline" onClick={onCreate}>
            Create your first character
          </Button>
        }
      />
    )
  return (
    <div className="grid grid-cols-3 gap-3.5 md:grid-cols-5 xl:grid-cols-7">
      {cards.map((card) => (
        <CharacterCard key={card.node.id} card={card} />
      ))}
      <NewCard label="New character" aspect="3 / 4" onClick={onCreate} />
    </div>
  )
}

/** Four 16:9 cards a row, ending in a dashed "New scene". */
export function SceneGrid({
  cards,
  onCreate,
}: {
  cards: ReturnType<typeof containerCards> | null
  onCreate: () => void
}) {
  if (cards === null)
    return <Skeleton className="aspect-video w-full max-w-72 rounded-lg" />
  if (cards.length === 0)
    return (
      <EmptySection
        title="No scenes yet"
        body="A scene holds a location's references, so every shot there matches."
        action={
          <Button size="sm" variant="outline" onClick={onCreate}>
            Create your first scene
          </Button>
        }
      />
    )
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {cards.map((card) => (
        <SceneCard key={card.node.id} card={card} />
      ))}
      <NewCard label="New scene" aspect="16 / 9" onClick={onCreate} />
    </div>
  )
}
