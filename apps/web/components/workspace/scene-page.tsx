"use client"

/**
 * A scene's page (C3): the shared frame, with the scene's cast under its
 * description and Open canvas beside the primary "Generate in scene".
 *
 * The cast is derived in main (`containers:related`): a character is in the
 * scene when a run filed here mentioned it. There is no "+ Add" — an explicit
 * cast needs a column of its own (§6.3), and until then the way into a cast is
 * a prompt.
 *
 * Shots (Phase 3b) are not here yet. When they land, `SCENE_TABS` gains
 * "shots" first, and `renderTab` below draws the storyboard and its versions
 * strip for it — see `SHOTS_SEAM`.
 */
import type {
  ContainerDto,
  ContainerNodeDto,
  ContainerSummaryDto,
} from "@opendirect/contract"
import Link from "next/link"
import { Skeleton } from "@workspace/ui/components/skeleton"

import {
  useContainerSummaries,
  useRelatedContainers,
} from "@/hooks/use-containers"
import { containerHref } from "@/lib/shell/routes"
import { SCENE_TABS } from "@/lib/workspace/container-page"

import { Avatar } from "./container-card"
import { OpenCanvasButton } from "./home"
import { SubjectPage, type SubjectCopy } from "./subject-page"

const COPY: SubjectCopy = {
  section: "Scenes",
  href: "/scenes/",
  references: "Location references, in order",
  placeholder: "Pick a cover for this scene",
}

const NO_CAST: readonly ContainerDto[] = []

/** The cast as chips: each a face and a name, and a way to that page. */
function Cast({
  sceneId,
  cast,
  pending,
}: {
  sceneId: string
  cast: readonly ContainerDto[]
  pending: boolean
}) {
  const summaries = useContainerSummaries()
  const faces = new Map(
    (summaries.data ?? []).map((entry) => [entry.id, entry.coverAsset])
  )
  const headingId = `cast-${sceneId}`
  return (
    <div className="mt-1 flex flex-col gap-2">
      <span
        id={headingId}
        className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        Cast
      </span>
      {pending ? (
        <Skeleton className="h-9 w-40 rounded-full" />
      ) : cast.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody yet. Mention a character in a prompt here and they join the
          cast.
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
          {cast.map((character) => (
            <li key={character.id}>
              <Link
                href={containerHref(character.id)}
                className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-[13px] font-medium transition-colors hover:bg-muted"
              >
                <Avatar
                  name={character.name}
                  cover={faces.get(character.id) ?? null}
                />
                {character.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ScenePage({
  node,
  summary,
  tab,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
  tab: string | null
}) {
  const related = useRelatedContainers(node.id)
  const cast =
    related.data?.kind === "scene" ? related.data.characters : NO_CAST

  return (
    <SubjectPage
      node={node}
      summary={summary}
      tab={tab}
      tabs={SCENE_TABS}
      counts={{
        assets: summary?.assetCount,
        generations: summary?.generationCount,
      }}
      copy={COPY}
      generateLabel="Generate in scene"
      actions={<OpenCanvasButton focus={node.id} />}
      details={
        <Cast sceneId={node.id} cast={cast} pending={related.isPending} />
      }
      // SHOTS_SEAM (Phase 3b): the storyboard of numbered shot cards and the
      // picked shot's versions strip render here for a "shots" tab, which
      // goes first in `SCENE_TABS`. Until then a scene has only the frame's
      // own Generations and Assets tabs.
      renderTab={() => null}
    />
  )
}
