"use client"

/**
 * Two takes, side by side.
 *
 * Comparing generative video is a timing problem: two clips of the same prompt
 * differ in a gesture that lasts half a second, and two players with their own
 * transport controls will never be on the same frame when you need them to be.
 * So there is one transport here, not two — a single `requestAnimationFrame`
 * loop keeps the follower on the leader's clock, and the scrub bar moves both.
 *
 * Under the players, only what actually differs. A full parameter dump would
 * bury the one field that explains the difference, which is the only thing
 * this dialog is for.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AssetDto, GenerationDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { useGeneration } from "@/hooks/use-generations"

/** How far apart the two players may drift before the follower is nudged. */
const SYNC_TOLERANCE_SECONDS = 0.08

export interface CompareViewProps {
  left: AssetDto
  /** Everything else on the board, as the other side of the comparison. */
  candidates: readonly AssetDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ParamDifference {
  field: string
  left: string
  right: string
}

function readParams(generation: GenerationDto | undefined): Record<
  string,
  unknown
> {
  if (!generation) return {}
  try {
    const parsed: unknown = JSON.parse(generation.paramsJson)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function show(value: unknown): string {
  if (value === undefined) return "—"
  return typeof value === "string" ? value : JSON.stringify(value)
}

/** Only the fields whose values disagree, in the order the left run lists them. */
export function diffParams(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): ParamDifference[] {
  const fields = [...Object.keys(left), ...Object.keys(right)].filter(
    (field, index, list) => list.indexOf(field) === index
  )
  return fields
    .filter((field) => show(left[field]) !== show(right[field]))
    .map((field) => ({
      field,
      left: show(left[field]),
      right: show(right[field]),
    }))
}

function label(asset: AssetDto): string {
  return asset.label ?? asset.originalName ?? asset.kind
}

function Pane({
  asset,
  videoRef,
  onDuration,
}: {
  asset: AssetDto
  videoRef?: React.RefObject<HTMLVideoElement | null>
  /** Reported once the browser knows how long this clip is. */
  onDuration?: (seconds: number) => void
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {asset.kind === "video" && asset.url ? (
        <video
          ref={videoRef}
          src={asset.url}
          poster={asset.thumbnailUrl ?? undefined}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(event) =>
            onDuration?.(event.currentTarget.duration || 0)
          }
          className="w-full rounded-md bg-muted"
        />
      ) : asset.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.url}
          alt={label(asset)}
          className="w-full rounded-md bg-muted"
        />
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm">
          {asset.text ?? label(asset)}
        </p>
      )}
      <figcaption className="truncate text-xs text-muted-foreground">
        {label(asset)}
      </figcaption>
    </figure>
  )
}

export function CompareView({
  left,
  candidates,
  open,
  onOpenChange,
}: CompareViewProps) {
  const others = useMemo(
    () => candidates.filter((asset) => asset.id !== left.id),
    [candidates, left.id]
  )
  const [rightId, setRightId] = useState<string | null>(
    () => others[0]?.id ?? null
  )
  const right = others.find((asset) => asset.id === rightId) ?? null

  const leftVideo = useRef<HTMLVideoElement | null>(null)
  const rightVideo = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  /** Per asset, so swapping the right-hand clip re-measures instead of
   *  keeping the length of one that is no longer on screen. */
  const [durations, setDurations] = useState<Record<string, number>>({})

  const reportDuration = useCallback(
    (assetId: string, seconds: number) =>
      setDurations((current) => ({ ...current, [assetId]: seconds })),
    []
  )

  /** The pair is as long as its longer half, so the scrub bar covers both. */
  const duration = Math.max(
    durations[left.id] ?? 0,
    right ? (durations[right.id] ?? 0) : 0
  )

  const leftGeneration = useGeneration(open ? left.generationId : null)
  const rightGeneration = useGeneration(open ? (right?.generationId ?? null) : null)

  const differences = useMemo(
    () =>
      diffParams(
        readParams(leftGeneration.data?.generation),
        readParams(rightGeneration.data?.generation)
      ),
    [leftGeneration.data, rightGeneration.data]
  )

  /** One clock for both players: the left one leads, the right one follows. */
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const leader = leftVideo.current
      const follower = rightVideo.current
      if (leader) {
        setTime(leader.currentTime)
        if (
          follower &&
          Math.abs(follower.currentTime - leader.currentTime) >
            SYNC_TOLERANCE_SECONDS
        ) {
          follower.currentTime = leader.currentTime
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const both = useCallback(
    (run: (video: HTMLVideoElement) => void) => {
      for (const ref of [leftVideo, rightVideo]) {
        if (ref.current) run(ref.current)
      }
    },
    []
  )

  /** Closing the dialog must not leave audio-less video running off-screen. */
  useEffect(
    () => () => {
      both((video) => video.pause?.())
    },
    [both]
  )

  const scrubbable =
    left.kind === "video" && right !== null && right.kind === "video"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription>
            Both players share one transport, so they stay on the same frame.
          </DialogDescription>
        </DialogHeader>

        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There is nothing else on this board to compare with yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Pane
                asset={left}
                videoRef={leftVideo}
                onDuration={(seconds) => reportDuration(left.id, seconds)}
              />
              <div className="flex min-w-0 flex-col gap-2">
                <Select
                  value={rightId ?? undefined}
                  onValueChange={(value: string | null) => setRightId(value)}
                >
                  <SelectTrigger size="sm" aria-label="Compare with">
                    <SelectValue placeholder="Choose an output">
                      {(value: unknown) => {
                        const chosen = others.find(
                          (asset) => asset.id === value
                        )
                        return chosen ? label(chosen) : "Choose an output"
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {label(asset)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {right ? (
                  <Pane
                    asset={right}
                    videoRef={rightVideo}
                    onDuration={(seconds) => reportDuration(right.id, seconds)}
                  />
                ) : null}
              </div>
            </div>

            {scrubbable ? (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const next = !playing
                    setPlaying(next)
                    both((video) => {
                      if (next) void video.play?.().catch(() => {})
                      else video.pause?.()
                    })
                  }}
                >
                  <HugeiconsIcon
                    icon={playing ? PauseIcon : PlayIcon}
                    className="size-4"
                  />
                  {playing ? "Pause" : "Play both"}
                </Button>
                <input
                  type="range"
                  aria-label="Scrub both clips"
                  min={0}
                  max={Math.max(duration, 0.1)}
                  step={0.01}
                  value={time}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setTime(next)
                    both((video) => {
                      video.currentTime = next
                    })
                  }}
                  className="flex-1 accent-primary"
                />
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {time.toFixed(2)}s / {duration.toFixed(2)}s
                </span>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                {differences.length === 0
                  ? "These two ran with the same parameters."
                  : "Parameters that differ"}
              </p>
              {differences.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 text-left font-normal">Field</th>
                      <th className="py-1 text-left font-normal">
                        {label(left)}
                      </th>
                      <th className="py-1 text-left font-normal">
                        {right ? label(right) : "—"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {differences.map((row) => (
                      <tr key={row.field} className="border-t">
                        <td className="py-1 pr-3">{row.field}</td>
                        <td className="py-1 pr-3">{row.left}</td>
                        <td className="py-1">{row.right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
