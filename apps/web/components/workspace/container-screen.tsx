"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type {
  ContainerNodeDto,
  ContainerSummaryDto,
} from "@opendirect/contract"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useContainerSummaries, useContainerTree } from "@/hooks/use-containers"
import { findContainer } from "@/lib/board/sidebar-tree"
import { rememberFilingContainer } from "@/lib/canvas/filing"
import { shotHref } from "@/lib/shell/routes"
import { statsLine } from "@/lib/workspace/container-page"

import { AssetLibrary } from "./asset-library"
import { EmptySection } from "./container-card"
import { OpenCanvasButton } from "./home"
import { CharacterPage } from "./character-page"
import { ScenePage } from "./scene-page"
import { Breadcrumb } from "./subject-page"
import { WorkspacePage } from "./workspace-page"

/**
 * A folder's page: its name, its counts and its assets. Folders have no
 * handle, no references and nothing to generate with — they are where things
 * are filed — so the canvas is the one place to go from here.
 */
function FolderPage({
  node,
  summary,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
}) {
  return (
    <WorkspacePage
      title={<Breadcrumb section="Folders" href={null} name={node.name} />}
      actions={<OpenCanvasButton focus={node.id} />}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">{node.name}</h2>
          {node.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {node.description}
            </p>
          ) : null}
          {summary ? (
            <p className="text-xs text-muted-foreground">
              {statsLine(summary)}
            </p>
          ) : null}
        </div>
        <AssetLibrary node={node} />
      </div>
    </WorkspacePage>
  )
}

/**
 * `/container/?id=` — dispatches on the container's kind: a character (C1) or
 * a scene (C3) gets its own page with the generate panel, a folder a plain
 * asset grid.
 *
 * The page replaces the old library dialog a sidebar row used to open. Its
 * reference picking, importing and "generate with this" now live on the page
 * itself, and none of it spends money without the panel's Generate click.
 *
 * A shot has no page of its own. `?id=<shot>` is replaced by its scene's page
 * on the Shots tab with that shot selected (`shotHref`), so a link to a shot
 * from anywhere lands where its versions are.
 */
export function ContainerScreen({
  id,
  tab = null,
  shot = null,
}: {
  id: string | null
  /** `&tab=` — the character or scene page's open tab. */
  tab?: string | null
  /** `&shot=` — the scene's selected shot. */
  shot?: string | null
}) {
  const router = useRouter()
  const tree = useContainerTree()
  const summaries = useContainerSummaries()

  const node = useMemo(
    () => (id && tree.data ? findContainer(tree.data, id) : null),
    [id, tree.data]
  )
  const summary = summaries.data?.find((entry) => entry.id === id) ?? null

  // The container you were last looking at is where the canvas files new
  // nodes when it is opened without a focus.
  // A shot is filed from its scene's page, never remembered as a place.
  useEffect(() => {
    if (node && node.kind !== "shot") rememberFilingContainer(node.id)
  }, [node])

  const shotScene = node?.kind === "shot" ? node.parentId : null
  useEffect(() => {
    if (node && shotScene)
      router.replace(shotHref(shotScene, node.id), { scroll: false })
  }, [node, shotScene, router])

  if (tree.isPending || shotScene) {
    return (
      <WorkspacePage title={<Skeleton className="h-4 w-32" />}>
        <Skeleton className="h-40 w-72 rounded-lg" />
      </WorkspacePage>
    )
  }

  if (!node) {
    return (
      <WorkspacePage title="Not found">
        <EmptySection
          title="This container no longer exists"
          body="It may have been deleted. Its assets are still in the project."
          action={
            <Link href="/" className="text-sm underline underline-offset-4">
              Back to Home
            </Link>
          }
        />
      </WorkspacePage>
    )
  }

  // Keyed, so moving from one character or scene to another starts the page
  // — an open panel, a half-finished edit — afresh.
  switch (node.kind) {
    case "character":
      return (
        <CharacterPage key={node.id} node={node} summary={summary} tab={tab} />
      )
    case "scene":
      return (
        <ScenePage
          key={node.id}
          node={node}
          summary={summary}
          tab={tab}
          shot={shot}
        />
      )
    default:
      return <FolderPage node={node} summary={summary} />
  }
}
