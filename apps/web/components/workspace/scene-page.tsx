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
 * The page opens on its shots (`shots-tab.tsx`): the storyboard, and the
 * selected shot's versions. A shot's "Generate version" aims this page's
 * generate panel at the shot, so its run is filed under the shot.
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
import { shotAim, shotsOf } from "@/lib/workspace/shots"

import { Avatar } from "./container-card"
import { OpenCanvasButton } from "./home"
import { ShotsTab } from "./shots-tab"
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
  shot = null,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
  tab: string | null
  /** `&shot=` — the selected shot on the Shots tab. */
  shot?: string | null
}) {
  const related = useRelatedContainers(node.id)
  const summaries = useContainerSummaries()
  const cast =
    related.data?.kind === "scene" ? related.data.characters : NO_CAST
  const shots = shotsOf(node)
  // The scene's summary counts its shots' runs too; the Generations tab
  // lists only the runs filed straight under the scene.
  const inShots = shots.reduce(
    (sum, one) =>
      sum +
      (summaries.data?.find((entry) => entry.id === one.id)?.generationCount ??
        0),
    0
  )
  const direct =
    summary === null
      ? undefined
      : Math.max(0, summary.generationCount - inShots)

  return (
    <SubjectPage
      node={node}
      summary={summary}
      tab={tab}
      tabs={SCENE_TABS}
      counts={{
        shots: shots.length,
        assets: summary?.assetCount,
        generations: direct,
      }}
      copy={COPY}
      generateLabel="Generate in scene"
      actions={<OpenCanvasButton focus={node.id} />}
      details={
        <Cast sceneId={node.id} cast={cast} pending={related.isPending} />
      }
      otherAim={shotAim(node, shot)}
      generationsNote={
        inShots > 0 ? (
          <Link
            href={containerHref(node.id, "shots")}
            replace
            scroll={false}
            className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {inShots} more in shots →
          </Link>
        ) : null
      }
      renderTab={(open, { generateOther }) =>
        open === "shots" ? (
          <ShotsTab scene={node} selectedId={shot} onGenerate={generateOther} />
        ) : null
      }
    />
  )
}
