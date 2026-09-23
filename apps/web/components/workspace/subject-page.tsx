"use client"

/**
 * A character's page (C1) — and, until the scene page's cast and shots land,
 * a scene's, which the design lays out the same way.
 *
 * Header: the cover, then the name and `@handle`, the description, the counts
 * and the references sent to the model, all editable here. Tabs below it live
 * in the query string (`&tab=generations`), and Canvas is a link to the canvas
 * framed on this container — ⛔ never an embedded canvas.
 *
 * "Generate with @mira" opens the generate panel (C2) at the right of the
 * page. Opening it spends nothing; its own Generate button is the only thing
 * on this page that does, and a queued run then shows on the Generations tab.
 */
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Edit02Icon,
  MagicWand01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import type {
  ContainerNodeDto,
  ContainerSummaryDto,
} from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useAsset } from "@/hooks/use-assets"
import { useSetContainerReferences } from "@/hooks/use-containers"
import { canvasHref, containerHref } from "@/lib/shell/routes"
import {
  parseTab,
  statsLine,
  toggleReference,
  type PageTab,
} from "@/lib/workspace/container-page"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"

import { AssetLibrary } from "./asset-library"
import { ContainerDetailsForm } from "./container-details"
import { ContainerRuns } from "./container-runs"
import { GeneratePanel } from "./generate-panel"
import { ReferenceStrip } from "./reference-strip"
import { WorkspacePage } from "./workspace-page"

type Subject = "character" | "scene"

const COPY: Record<
  Subject,
  {
    section: string
    href: string
    references: string
    placeholder: string
    firstTab: PageTab
  }
> = {
  character: {
    section: "Characters",
    href: "/characters/",
    references: "References sent to the model, in order",
    placeholder: "Pick a character sheet",
    firstTab: "assets",
  },
  scene: {
    section: "Scenes",
    href: "/scenes/",
    references: "Location references, in order",
    placeholder: "Pick a cover for this scene",
    // Until shots ship, a scene opens on what has been made in it (§5).
    firstTab: "generations",
  },
}

export function Breadcrumb({
  section,
  href,
  name,
}: {
  section: string
  href: string | null
  name: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      {href ? (
        <Link
          href={href}
          className="font-normal text-muted-foreground hover:text-foreground"
        >
          {section}
        </Link>
      ) : (
        <span className="font-normal text-muted-foreground">{section}</span>
      )}
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      <span>{name}</span>
    </span>
  )
}

/**
 * The picture at the top left: the first reference — the character sheet —
 * for a character; the card's cover for a scene.
 */
function Cover({
  node,
  summary,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
}) {
  const kind = node.kind as Subject
  const sheetId =
    kind === "character" ? (node.referenceAssetIds?.[0] ?? null) : null
  const sheet = useAsset(sheetId)
  const cover =
    kind === "character" ? (sheet.data ?? null) : summary?.coverAsset
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-muted",
        kind === "character" ? "h-62.5 w-100" : "h-62 w-110"
      )}
    >
      {cover ? (
        <>
          <div aria-hidden className="size-full">
            <AssetTile asset={cover} className="size-full" />
          </div>
          {kind === "character" ? (
            <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-status-running backdrop-blur-sm">
              <HugeiconsIcon icon={StarIcon} className="size-3" />
              Character sheet
            </span>
          ) : null}
        </>
      ) : (
        <span className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {COPY[kind].placeholder}
        </span>
      )}
    </div>
  )
}

function Tabs({
  node,
  tab,
  counts,
}: {
  node: ContainerNodeDto
  tab: PageTab
  counts: { assets?: number; generations?: number }
}) {
  const kind = node.kind as Subject
  const order: PageTab[] =
    kind === "scene" ? ["generations", "assets"] : ["assets", "generations"]
  const label: Record<PageTab, string> = {
    assets: "Assets",
    generations: "Generations",
  }
  const item =
    "inline-flex h-10 items-center gap-1.5 border-b-2 text-sm transition-colors"
  return (
    <nav aria-label="Sections" className="flex gap-6 border-b">
      {order.map((one) => (
        <Link
          key={one}
          href={containerHref(node.id, one)}
          replace
          scroll={false}
          aria-current={tab === one ? "page" : undefined}
          className={cn(
            item,
            tab === one
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {label[one]}
          {counts[one] !== undefined ? (
            <span className="text-[11px] text-muted-foreground">
              {counts[one]}
            </span>
          ) : null}
        </Link>
      ))}
      {/* §8: the canvas is a place you go to, not a tab that embeds it. */}
      <Link
        href={canvasHref(node.id)}
        className={cn(
          item,
          "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        Canvas
        <span aria-hidden className="text-[11px]">
          ↗
        </span>
      </Link>
    </nav>
  )
}

export function SubjectPage({
  node,
  summary,
  tab: rawTab,
}: {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
  tab: string | null
}) {
  const kind = node.kind as Subject
  const copy = COPY[kind]
  const router = useRouter()
  const tab = rawTab === null ? copy.firstTab : parseTab(rawTab)
  const [editing, setEditing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const references = useSetContainerReferences()

  const saveReferences = (assetIds: string[] | null) =>
    references.mutate(
      { id: node.id, assetIds },
      {
        onError: (error) => toast.error(error.message),
      }
    )

  const generateLabel =
    kind === "scene"
      ? "Generate in scene"
      : node.handle
        ? `Generate with @${node.handle}`
        : "Generate"

  return (
    <WorkspacePage
      title={
        <Breadcrumb section={copy.section} href={copy.href} name={node.name} />
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={editing}
            onClick={() => setEditing((on) => !on)}
          >
            <HugeiconsIcon icon={Edit02Icon} className="size-4" />
            Edit
          </Button>
          <Button
            size="sm"
            aria-pressed={generating}
            onClick={() => setGenerating(true)}
          >
            <HugeiconsIcon icon={MagicWand01Icon} className="size-4" />
            {generateLabel}
          </Button>
        </>
      }
      rail={
        generating ? (
          <GeneratePanel
            node={node}
            cover={summary?.coverAsset ?? null}
            onClose={() => setGenerating(false)}
            onSubmitted={() =>
              router.replace(containerHref(node.id, "generations"), {
                scroll: false,
              })
            }
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-start gap-8">
          <Cover node={node} summary={summary} />
          <div className="flex max-w-155 min-w-0 flex-1 flex-col gap-3">
            {editing ? (
              <ContainerDetailsForm
                node={node}
                onDone={() => setEditing(false)}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-3xl font-semibold tracking-tight">
                    {node.name}
                  </h2>
                  {node.handle ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
                      @{node.handle}
                    </span>
                  ) : null}
                </div>
                {node.description ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {node.description}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Add a description — what a mention becomes on a model that
                    takes no image
                  </button>
                )}
              </>
            )}
            {summary ? (
              <p className="text-xs text-muted-foreground">
                {statsLine(summary)}
              </p>
            ) : null}
            <div className="mt-2">
              <ReferenceStrip
                node={node}
                label={copy.references}
                onChange={saveReferences}
                saving={references.isPending}
              />
            </div>
          </div>
        </div>

        <Tabs
          node={node}
          tab={tab}
          counts={{
            assets: summary?.assetCount,
            generations: summary?.generationCount,
          }}
        />

        {tab === "generations" ? (
          <ContainerRuns
            containerId={node.id}
            empty={
              <Button size="sm" onClick={() => setGenerating(true)}>
                {generateLabel}
              </Button>
            }
          />
        ) : (
          <AssetLibrary
            node={node}
            saving={references.isPending}
            onToggleReference={(assetId) =>
              saveReferences(toggleReference(node.referenceAssetIds, assetId))
            }
          />
        )}
      </div>
    </WorkspacePage>
  )
}
