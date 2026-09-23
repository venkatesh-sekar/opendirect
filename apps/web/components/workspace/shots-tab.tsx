"use client"

/**
 * A scene's Shots tab (C3): the storyboard of numbered shot cards, and the
 * selected shot's versions strip below it.
 *
 * A shot is a child container of the scene. Its label is its description,
 * its number is its place, and its versions are what the runs filed under it
 * made (`lib/workspace/shots.ts`). Clicking a version picks it
 * (`containers:setPick`); the card then wears the pick, amber-ringed in the
 * strip.
 *
 * ⛔ Nothing on this tab spends money. "Generate version" opens the page's
 * generate panel aimed at the shot; only that panel's Generate button runs.
 */
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  MagicWand01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import type { ContainerNodeDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  useCreateContainer,
  useReorderContainer,
  useSetContainerDescription,
  useSetContainerPick,
} from "@/hooks/use-containers"
import { useGenerations } from "@/hooks/use-generations"
import { useJobs } from "@/hooks/use-jobs"
import { shotHref } from "@/lib/shell/routes"
import { modelName } from "@/lib/workspace/home"
import {
  coverVersion,
  pickLine,
  pickedVersion,
  selectedShot,
  shotNumber,
  shotTitle,
  shotVersions,
  shotsOf,
  type ShotVersion,
} from "@/lib/workspace/shots"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"
import { DeleteContainerDialog } from "@/components/shell/container-tree"

import { ProgressBar } from "./run-tile"

/** The newest runs a shot's versions are read from. */
const LIMIT = 200

/** A shot's versions, from its own runs and the job list. */
function useShotVersions(shotId: string) {
  const generations = useGenerations(shotId, { limit: LIMIT })
  const jobs = useJobs()
  const versions = shotVersions({
    shotId,
    generations: generations.data?.items ?? [],
    total: generations.data?.total,
    outputs: generations.data?.outputs ?? [],
    jobs: jobs.data ?? [],
  })
  return { versions, pending: generations.isPending }
}

/** "Generating" and the amber bar, over a card or a version. */
function Running({ progress }: { progress: number | null }) {
  return (
    <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1.5">
      <div className="flex justify-between text-[11px]">
        <span className="font-medium text-status-running">Generating</span>
        {progress !== null ? (
          <span className="font-mono text-muted-foreground">
            {Math.round(progress * 100)}%
          </span>
        ) : null}
      </div>
      <ProgressBar progress={progress} />
    </div>
  )
}

function ShotCard({
  scene,
  shot,
  index,
  selected,
}: {
  scene: ContainerNodeDto
  shot: ContainerNodeDto
  index: number
  selected: boolean
}) {
  const { versions, pending } = useShotVersions(shot.id)
  const cover = coverVersion(versions, shot.pickedAssetId)
  const newest = versions[versions.length - 1] ?? null
  const running = versions.find((version) => version.running) ?? null
  const shown = cover ?? newest
  const label = shot.description ?? "Untitled shot"

  return (
    <Link
      href={shotHref(scene.id, shot.id)}
      replace
      scroll={false}
      aria-current={selected ? "true" : undefined}
      aria-label={`${shotTitle(index)}: ${label}`}
      className="group flex min-w-0 flex-col gap-2.5"
    >
      <div
        className={cn(
          "relative h-37.5 w-full shrink-0 overflow-hidden rounded-[10px] bg-muted transition-opacity group-hover:opacity-90",
          selected &&
            "ring-2 ring-foreground ring-offset-2 ring-offset-background",
          running &&
            "outline-1 -outline-offset-1 outline-status-running outline-dashed"
        )}
      >
        {pending ? (
          <Skeleton className="size-full" />
        ) : cover?.asset ? (
          <div aria-hidden className="size-full">
            <AssetTile asset={cover.asset} className="size-full" />
          </div>
        ) : null}
        {newest && !running ? (
          <span className="absolute top-2 right-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">
            {newest.label}
          </span>
        ) : null}
        {running ? <Running progress={running.progress} /> : null}
        {!pending && versions.length === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">
            No versions yet
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {shotNumber(index)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              "line-clamp-2 text-[13px] leading-snug font-medium",
              !shot.description && "text-muted-foreground"
            )}
          >
            {label}
          </span>
          {shown ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {modelName(shown.generation.modelSlug)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

/** The shot's label, saved when the field is left or Enter is pressed. */
function LabelField({
  shot,
  title,
}: {
  shot: ContainerNodeDto
  title: string
}) {
  const save = useSetContainerDescription()
  const [value, setValue] = useState(shot.description ?? "")
  const commit = () => {
    const next = value.trim()
    if (next === (shot.description ?? "")) return
    save.mutate(
      { id: shot.id, description: next === "" ? null : next },
      { onError: (error) => toast.error(error.message) }
    )
  }
  return (
    <Input
      aria-label={`${title} label`}
      placeholder="Describe the shot — Wide, Mira steps out of the lift"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
      className="h-8 max-w-110 flex-1 text-sm"
    />
  )
}

function VersionTile({
  version,
  picked,
  saving,
  onPick,
}: {
  version: ShotVersion
  picked: boolean
  saving: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={
        version.asset
          ? version.label
          : `${version.label}, ${version.running ? "generating" : "no picture"}`
      }
      aria-pressed={version.asset ? picked : undefined}
      disabled={!version.asset || saving}
      onClick={onPick}
      className={cn(
        "relative h-24 w-full overflow-hidden rounded-lg bg-muted text-left transition-opacity enabled:hover:opacity-90",
        picked && "ring-2 ring-status-running",
        version.running &&
          "outline-1 -outline-offset-1 outline-status-running outline-dashed"
      )}
    >
      {version.asset ? (
        <div aria-hidden className="size-full">
          <AssetTile asset={version.asset} className="size-full" />
        </div>
      ) : null}
      <span className="absolute top-1.5 left-1.5 rounded bg-background/80 px-1 text-[10px] font-medium backdrop-blur-sm">
        {version.label}
      </span>
      {version.running ? (
        <Running progress={version.progress} />
      ) : !version.asset ? (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-muted-foreground">
          {version.generation.status === "failed"
            ? "Failed"
            : version.generation.status === "canceled"
              ? "Canceled"
              : "No output"}
        </span>
      ) : null}
    </button>
  )
}

/** The selected shot: its label, its place, its versions and the pick. */
function ShotVersions({
  scene,
  shot,
  index,
  count,
  onGenerate,
}: {
  scene: ContainerNodeDto
  shot: ContainerNodeDto
  index: number
  count: number
  onGenerate: () => void
}) {
  const { versions, pending } = useShotVersions(shot.id)
  const pick = useSetContainerPick()
  const reorder = useReorderContainer()
  const [deleting, setDeleting] = useState(false)
  const title = shotTitle(index)
  const picked = pickedVersion(versions, shot.pickedAssetId)

  const move = (to: number) =>
    reorder.mutate(
      { id: shot.id, index: to },
      { onError: (error) => toast.error(error.message) }
    )
  const choose = (version: ShotVersion) =>
    pick.mutate(
      {
        id: shot.id,
        // Clicking the pick again un-picks it.
        assetId: picked?.key === version.key ? null : version.asset!.id,
      },
      { onError: (error) => toast.error(error.message) }
    )

  return (
    <section
      aria-label={`${title} versions`}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{title} · versions</span>
        <span className="text-xs text-muted-foreground">
          {pending ? "" : pickLine(versions, shot.pickedAssetId)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Keyed: another shot's label must not linger in the field. */}
        <LabelField key={shot.id} shot={shot} title={title} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${title} earlier`}
          disabled={index === 0 || reorder.isPending}
          onClick={() => move(index - 1)}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${title} later`}
          disabled={index === count - 1 || reorder.isPending}
          onClick={() => move(index + 1)}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${title}`}
          onClick={() => setDeleting(true)}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
        </Button>
        <Button size="sm" className="ml-auto" onClick={onGenerate}>
          <HugeiconsIcon icon={MagicWand01Icon} className="size-4" />
          Generate version
        </Button>
      </div>

      {pending ? (
        <div className="grid grid-cols-3 gap-2.5 md:grid-cols-6">
          {[0, 1, 2].map((one) => (
            <Skeleton key={one} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing made for {scene.name} · {title} yet. Generate a version and it
          lands here, ready to pick.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 md:grid-cols-6">
          {versions.map((version) => (
            <VersionTile
              key={version.key}
              version={version}
              picked={picked?.key === version.key}
              saving={pick.isPending}
              onPick={() => choose(version)}
            />
          ))}
        </div>
      )}

      <DeleteContainerDialog
        node={{ ...shot, name: title }}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </section>
  )
}

export interface ShotsTabProps {
  scene: ContainerNodeDto
  /** `&shot=` — anything that is not one of the scene's shots selects the first. */
  selectedId: string | null
  /**
   * Opens the page's generate panel on the selected shot (`shotAim`), which
   * follows the selection from then on. Spends nothing.
   */
  onGenerate: () => void
}

export function ShotsTab({ scene, selectedId, onGenerate }: ShotsTabProps) {
  const router = useRouter()
  const create = useCreateContainer()
  const shots = shotsOf(scene)
  const current = selectedShot(scene, selectedId)
  const selected = current?.shot ?? null
  const index = current?.index ?? 0

  const addShot = () =>
    create.mutate(
      { kind: "shot", parentId: scene.id, name: `Shot ${shots.length + 1}` },
      {
        onSuccess: (shot) =>
          router.replace(shotHref(scene.id, shot.id), { scroll: false }),
        onError: (error) => toast.error(error.message),
      }
    )

  return (
    <div className="flex flex-col gap-5.5">
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
        {shots.map((shot, at) => (
          <ShotCard
            key={shot.id}
            scene={scene}
            shot={shot}
            index={at}
            selected={shot.id === selected?.id}
          />
        ))}
        <button
          type="button"
          onClick={addShot}
          disabled={create.isPending}
          className="flex h-37.5 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
          New shot
        </button>
      </div>

      {selected ? (
        <ShotVersions
          scene={scene}
          shot={selected}
          index={index}
          count={shots.length}
          onGenerate={onGenerate}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No shots yet. A shot is one beat of the scene; each one keeps its
          versions and the one you picked.
        </p>
      )}
    </div>
  )
}
