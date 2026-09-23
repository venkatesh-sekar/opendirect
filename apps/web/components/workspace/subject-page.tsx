"use client"

/**
 * What a character's page (C1) and a scene's (C3) share — the design lays
 * them out the same way, and `character-page.tsx` and `scene-page.tsx` fill
 * in what differs.
 *
 * Header: the cover, then the name and `@handle`, the description, whatever
 * the page adds below it (a character's counts, a scene's cast) and the
 * references sent to the model, all editable here. Tabs below it live in the
 * query string (`&tab=generations`), and Canvas is a link to the canvas
 * framed on this container — ⛔ never an embedded canvas.
 *
 * The primary button opens the generate panel (C2) at the right of the page.
 * Opening it spends nothing; its own Generate button is the only thing on
 * this page that does, and a queued run then shows on the Generations tab.
 */
import { useState, type ReactNode } from "react"
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
  AssetDto,
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
  toggleReference,
  type PageTab,
} from "@/lib/workspace/container-page"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"

import { AssetLibrary } from "./asset-library"
import { ContainerDetailsForm } from "./container-details"
import { ContainerRuns } from "./container-runs"
import { GeneratePanel, ownTarget, type GenerateTarget } from "./generate-panel"
import { ReferenceStrip } from "./reference-strip"
import { WorkspacePage } from "./workspace-page"

type Subject = "character" | "scene"

/** The words a page uses for itself. */
export interface SubjectCopy {
  /** The breadcrumb's first half, and where it links. */
  section: string
  href: string
  /** The reference strip's heading. */
  references: string
  /** What the cover says when there is no picture yet. */
  placeholder: string
}

const TAB_LABELS: Record<PageTab, string> = {
  shots: "Shots",
  assets: "Assets",
  generations: "Generations",
  "appears-in": "Appears in",
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
 * The container's face: the first reference — the character sheet — for a
 * character; the card's cover for a scene. The header and the generate
 * panel's identity row both wear this one picture.
 */
function useFace(
  node: ContainerNodeDto,
  summary: ContainerSummaryDto | null
): AssetDto | null {
  const character = node.kind === "character"
  const sheet = useAsset(
    character ? (node.referenceAssetIds?.[0] ?? null) : null
  )
  return character ? (sheet.data ?? null) : (summary?.coverAsset ?? null)
}

/** The picture at the top left. */
function Cover({
  node,
  cover,
  placeholder,
}: {
  node: ContainerNodeDto
  cover: AssetDto | null
  placeholder: string
}) {
  const kind = node.kind as Subject
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
          {placeholder}
        </span>
      )}
    </div>
  )
}

function Tabs({
  node,
  tab,
  tabs,
  counts,
}: {
  node: ContainerNodeDto
  tab: PageTab
  tabs: readonly PageTab[]
  counts: Partial<Record<PageTab, ReactNode>>
}) {
  const item =
    "inline-flex h-10 items-center gap-1.5 border-b-2 text-sm transition-colors"
  return (
    <nav aria-label="Sections" className="flex gap-6 border-b">
      {tabs.map((one) => (
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
          {TAB_LABELS[one]}
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

export interface SubjectPageProps {
  node: ContainerNodeDto
  summary: ContainerSummaryDto | null
  /** `&tab=` as it arrived; anything not in `tabs` opens the first. */
  tab: string | null
  /** The page's own tabs, in order. Canvas, a link, always follows them. */
  tabs: readonly PageTab[]
  /** What each tab shows dimmed after its label. */
  counts: Partial<Record<PageTab, ReactNode>>
  copy: SubjectCopy
  /** The primary button's words: "Generate with @mira". */
  generateLabel: string
  /** Buttons before Edit and the primary one — a scene's Open canvas. */
  actions?: ReactNode
  /** Below the description, above the references: counts, a cast. */
  details?: ReactNode
  /**
   * The body of a tab beyond Assets and Generations, which the frame draws
   * itself — a character's Appears in, a scene's shots. `generate` opens the
   * panel aimed somewhere else (a shot); `whenQueued` is where the page goes
   * once that run is queued.
   */
  renderTab?: (tab: PageTab, actions: SubjectPageActions) => ReactNode
}

export interface SubjectPageActions {
  /** Opens the generate panel for `target`. Spends nothing by itself. */
  generate: (target: GenerateTarget, whenQueued: string) => void
}

export function SubjectPage({
  node,
  summary,
  tab: rawTab,
  tabs,
  counts,
  copy,
  generateLabel,
  actions,
  details,
  renderTab,
}: SubjectPageProps) {
  const router = useRouter()
  const tab = parseTab(rawTab, tabs)
  const [editing, setEditing] = useState(false)
  /** The open panel's aim, and where the page goes once its run is queued. */
  const [generating, setGenerating] = useState<{
    target: GenerateTarget
    whenQueued: string
  } | null>(null)
  const openOwn = () =>
    setGenerating({
      target: ownTarget(node),
      whenQueued: containerHref(node.id, "generations"),
    })
  const references = useSetContainerReferences()
  const face = useFace(node, summary)

  const saveReferences = (assetIds: string[] | null) =>
    references.mutate(
      { id: node.id, assetIds },
      {
        onError: (error) => toast.error(error.message),
      }
    )

  let body: ReactNode
  switch (tab) {
    case "generations":
      body = (
        <ContainerRuns
          containerId={node.id}
          empty={
            <Button size="sm" onClick={openOwn}>
              {generateLabel}
            </Button>
          }
        />
      )
      break
    case "assets":
      body = (
        <AssetLibrary
          node={node}
          saving={references.isPending}
          onToggleReference={(assetId) =>
            saveReferences(toggleReference(node.referenceAssetIds, assetId))
          }
        />
      )
      break
    default:
      body =
        renderTab?.(tab, {
          generate: (target, whenQueued) =>
            setGenerating({ target, whenQueued }),
        }) ?? null
  }

  return (
    <WorkspacePage
      title={
        <Breadcrumb section={copy.section} href={copy.href} name={node.name} />
      }
      actions={
        <>
          {actions}
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
            aria-pressed={generating?.target.containerId === node.id}
            onClick={openOwn}
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
            cover={face}
            target={generating.target}
            onClose={() => setGenerating(null)}
            onSubmitted={() =>
              router.replace(generating.whenQueued, { scroll: false })
            }
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-start gap-8">
          <Cover node={node} cover={face} placeholder={copy.placeholder} />
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
            {details}
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

        <Tabs node={node} tab={tab} tabs={tabs} counts={counts} />

        {body}
      </div>
    </WorkspacePage>
  )
}
