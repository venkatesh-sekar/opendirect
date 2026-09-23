"use client"

/**
 * A character's page (C1): the shared frame, with the counts and the scenes
 * the character appears in under its description, and an Appears in tab.
 *
 * Who is in which scene is derived in main (`containers:related`) from the
 * runs filed under each scene — there is nothing to edit here.
 */
import { useMemo } from "react"
import type {
  ContainerDto,
  ContainerNodeDto,
  ContainerSummaryDto,
} from "@opendirect/contract"
import { Skeleton } from "@workspace/ui/components/skeleton"

import {
  useContainerSummaries,
  useContainerTree,
  useRelatedContainers,
} from "@/hooks/use-containers"
import {
  appearsInCount,
  CHARACTER_TABS,
  statsLine,
} from "@/lib/workspace/container-page"
import { containerCards } from "@/lib/workspace/home"

import { EmptySection, SceneCard } from "./container-card"
import { SubjectPage, type SubjectCopy } from "./subject-page"

const COPY: SubjectCopy = {
  section: "Characters",
  href: "/characters/",
  references: "References sent to the model, in order",
  placeholder: "Pick a character sheet",
}

const NO_SCENES: readonly ContainerDto[] = []

/** The scenes, as the same cards the Scenes page draws. */
function AppearsIn({
  node,
  scenes,
  pending,
}: {
  node: ContainerNodeDto
  scenes: readonly ContainerDto[]
  pending: boolean
}) {
  const tree = useContainerTree()
  const summaries = useContainerSummaries()
  const cards = useMemo(() => {
    const ids = new Set(scenes.map((scene) => scene.id))
    return containerCards(tree.data ?? [], summaries.data, "scene").filter(
      (card) => ids.has(card.node.id)
    )
  }, [scenes, summaries.data, tree.data])

  if (pending) return <Skeleton className="h-32 w-full rounded-lg" />
  if (cards.length === 0)
    return (
      <EmptySection
        title="Not in a scene yet"
        body={`Generate on a scene's page with ${node.handle ? `@${node.handle}` : node.name} in the prompt, and that scene is listed here.`}
      />
    )
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {cards.map((card) => (
        <SceneCard key={card.node.id} card={card} />
      ))}
    </div>
  )
}

export function CharacterPage({
  node,
  summary,
  tab,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
  tab: string | null
}) {
  const related = useRelatedContainers(node.id)
  const scenes =
    related.data?.kind === "character" ? related.data.scenes : NO_SCENES

  return (
    <SubjectPage
      node={node}
      summary={summary}
      tab={tab}
      tabs={CHARACTER_TABS}
      counts={{
        assets: summary?.assetCount,
        generations: summary?.generationCount,
        "appears-in": related.data ? appearsInCount(scenes.length) : undefined,
      }}
      copy={COPY}
      generateLabel={node.handle ? `Generate with @${node.handle}` : "Generate"}
      details={
        summary ? (
          <p className="text-xs text-muted-foreground">
            {statsLine(
              summary,
              scenes.map((scene) => scene.name)
            )}
          </p>
        ) : null
      }
      renderTab={(one) =>
        one === "appears-in" ? (
          <AppearsIn node={node} scenes={scenes} pending={related.isPending} />
        ) : null
      }
    />
  )
}
