"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useContainerSummaries, useContainerTree } from "@/hooks/use-containers"
import { findContainer } from "@/lib/board/sidebar-tree"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"
import { SubjectLibrary } from "@/components/shell/subject-library"

import { EmptySection } from "./container-card"
import { OpenCanvasButton } from "./home"
import { WorkspacePage } from "./workspace-page"

const SECTION = {
  character: { label: "Characters", href: "/characters/" },
  scene: { label: "Scenes", href: "/scenes/" },
  folder: { label: "Folders", href: null },
  project: { label: "Project", href: null },
} as const

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * `/container/?id=` — interim.
 *
 * The character, scene and folder pages are the next phase of the workspace
 * design. Until they land, a sidebar row or a card still has somewhere real to
 * go: the container's name, handle, description and counts, a way onto the
 * canvas framed on it, and the reference library that used to open straight
 * from the row — now behind a button, because a click on a row is navigation.
 */
export function ContainerScreen({ id }: { id: string | null }) {
  const tree = useContainerTree()
  const summaries = useContainerSummaries()
  const [library, setLibrary] = useState(false)

  const node = useMemo(
    () => (id && tree.data ? findContainer(tree.data, id) : null),
    [id, tree.data]
  )
  const summary = summaries.data?.find((entry) => entry.id === id) ?? null

  if (tree.isPending) {
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

  const section = SECTION[node.kind]
  const mentionable = node.kind === "character" || node.kind === "scene"
  const cover = summary?.coverAsset ?? null

  return (
    <WorkspacePage
      title={
        <span className="flex items-center gap-1.5">
          {section.href ? (
            <Link
              href={section.href}
              className="font-normal text-muted-foreground hover:text-foreground"
            >
              {section.label}
            </Link>
          ) : (
            <span className="font-normal text-muted-foreground">
              {section.label}
            </span>
          )}
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <span>{node.name}</span>
        </span>
      }
      actions={
        <>
          <OpenCanvasButton focus={node.id} />
          {mentionable ? (
            <Button size="sm" onClick={() => setLibrary(true)}>
              Open library
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-start gap-8">
        <div
          aria-hidden
          className="w-72 shrink-0 overflow-hidden rounded-lg bg-muted"
          style={{
            aspectRatio: node.kind === "character" ? "3 / 4" : "16 / 9",
          }}
        >
          {cover ? <AssetTile asset={cover} className="size-full" /> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{node.name}</h2>
          {node.handle ? (
            <span className="self-start rounded-md bg-muted px-2 py-0.5 font-mono text-sm">
              @{node.handle}
            </span>
          ) : null}
          {node.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {node.description}
            </p>
          ) : null}
          {summary ? (
            <p className="text-sm text-muted-foreground">
              {plural(summary.assetCount, "asset")} ·{" "}
              {plural(summary.generationCount, "generation")}
            </p>
          ) : null}
        </div>
      </div>

      {library ? (
        <SubjectLibrary node={node} onClose={() => setLibrary(false)} />
      ) : null}
    </WorkspacePage>
  )
}
