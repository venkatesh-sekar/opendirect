"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, StarIcon } from "@hugeicons/core-free-icons"
import { cn } from "@workspace/ui/lib/utils"

import type { AssetDto } from "@opendirect/contract"

import type {
  CastMember,
  ContainerCard as ContainerCardData,
} from "@/lib/workspace/home"
import { containerHref } from "@/lib/shell/routes"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"

function assets(count: number): string {
  return `${count} asset${count === 1 ? "" : "s"}`
}

/** A chip over a cover: the ★ Sheet mark, or a scene's asset count. */
function CoverBadge({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "absolute top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * The cover, or an empty box of the same shape. Decorative: the card's name
 * is what a screen reader should hear, not the asset's file label.
 */
function Cover({
  card,
  aspect,
  children,
}: {
  card: ContainerCardData
  aspect: string
  children?: React.ReactNode
}) {
  const cover = card.summary?.coverAsset ?? null
  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden rounded-lg bg-muted transition-opacity group-hover:opacity-90"
      style={{ aspectRatio: aspect }}
    >
      {cover ? <AssetTile asset={cover} className="size-full" /> : null}
      {children}
    </div>
  )
}

/** A 3:4 portrait card: cover, name, `@handle · N assets`. */
export function CharacterCard({ card }: { card: ContainerCardData }) {
  const { node, summary } = card
  return (
    <Link
      href={containerHref(node.id)}
      className="group flex min-w-0 flex-col gap-2.5"
    >
      <Cover card={card} aspect="3 / 4">
        {card.sheet ? (
          <CoverBadge className="left-2 text-status-running">
            <HugeiconsIcon icon={StarIcon} className="size-3" />
            Sheet
          </CoverBadge>
        ) : null}
      </Cover>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{node.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {node.handle ? (
            <span className="font-mono">@{node.handle}</span>
          ) : null}
          {node.handle && summary ? " · " : null}
          {summary ? assets(summary.assetCount) : null}
        </span>
      </span>
    </Link>
  )
}

/**
 * A character's face in a circle: its card's cover, or its initial. The
 * picture is decorative — whatever sits next to it says who this is.
 */
export function Avatar({
  name,
  cover,
  className,
}: {
  name: string
  cover: AssetDto | null
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      {cover ? (
        <AssetTile asset={cover} className="size-full" />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  )
}

/** How many faces a card stacks before it says "+N". */
const STACKED = 4

/** A scene card's overlapping cast avatars, named for a screen reader. */
function CastStack({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null
  const rest = cast.length - STACKED
  return (
    <span className="flex shrink-0 items-center">
      <span className="sr-only">
        Cast: {cast.map((member) => member.node.name).join(", ")}
      </span>
      {cast.slice(0, STACKED).map((member, index) => (
        <Avatar
          key={member.node.id}
          name={member.node.name}
          cover={member.cover}
          className={cn(
            "size-5.5 text-[10px] ring-2 ring-background",
            index > 0 && "-ml-1.5"
          )}
        />
      ))}
      {rest > 0 ? (
        <span
          aria-hidden
          className="-ml-1.5 inline-flex size-5.5 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-background"
        >
          +{rest}
        </span>
      ) : null}
    </span>
  )
}

/**
 * A 16:9 card: cover with its asset count, then the name and a stack of the
 * cast's avatars — drawn from the summary's `castIds`, so a grid of cards
 * costs no call per card.
 */
export function SceneCard({ card }: { card: ContainerCardData }) {
  const { node, summary } = card
  return (
    <Link
      href={containerHref(node.id)}
      className="group flex min-w-0 flex-col gap-2.5"
    >
      <Cover card={card} aspect="16 / 9">
        {summary ? (
          <CoverBadge className="right-2">
            {assets(summary.assetCount)}
          </CoverBadge>
        ) : null}
      </Cover>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{node.name}</span>
        <CastStack cast={card.cast} />
      </span>
    </Link>
  )
}

/** The dashed "New character" / "New scene" card at the end of a grid. */
export function NewCard({
  label,
  aspect,
  onClick,
}: {
  label: string
  aspect: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ aspectRatio: aspect }}
      className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
      {label}
    </button>
  )
}

/**
 * What a section says when there is nothing in it yet — a way to make the
 * first one, not a blank.
 */
export function EmptySection({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  )
}
