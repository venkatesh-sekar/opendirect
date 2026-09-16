"use client"

/**
 * Everything OpenDirect knows about one run.
 *
 * The panel exists because a generative workspace without provenance is a
 * folder of mystery files: six months later the only thing that makes an
 * output reproducible is the model, the version, the exact parameters and the
 * request that was actually sent. So this shows all of it, verbatim, including
 * the raw JSON — with the references named rather than expanded, because the
 * recorded request deliberately never carries their bytes.
 *
 * Cost is stated twice on purpose. An estimate and what the provider actually
 * charged are different facts, and a panel that collapsed them into one number
 * would be the place that hid a surprise.
 */
import { useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, GitBranchIcon } from "@hugeicons/core-free-icons"
import type { AssetDto, GenerationDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { useGeneration, useLineage } from "@/hooks/use-generations"
import { formatUsd } from "@/lib/price"

import { LineageView } from "./lineage-view"

export interface DetailsPanelProps {
  generationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ⛔ Pre-fills the creation bar from this run; it never submits. */
  onBranch?: (generationId: string) => void
}

function parseJson(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function timestamp(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString()
}

/** Provider logs, when the provider returns any (Replicate does). */
function logsOf(response: unknown): string | null {
  if (typeof response !== "object" || response === null) return null
  const logs = (response as { logs?: unknown }).logs
  return typeof logs === "string" && logs.trim() !== "" ? logs : null
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-xs">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px]">{children}</span>
}

/** Raw JSON, with the one affordance anyone ever wants from raw JSON. */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false)
  if (value === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing was recorded for {label.toLowerCase()} yet.
      </p>
    )
  }

  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  )
}

function costRows(generation: GenerationDto): [string, ReactNode][] {
  return [
    [
      "Estimated",
      <Mono key="est">
        {generation.estimatedCostUsd === null
          ? "Cost unknown"
          : `~${formatUsd(generation.estimatedCostUsd)}`}
      </Mono>,
    ],
    [
      "Actual",
      <Mono key="actual">
        {generation.actualCostUsd === null
          ? "Not reported by this provider"
          : formatUsd(generation.actualCostUsd)}
      </Mono>,
    ],
    [
      "Compute",
      <Mono key="predict">
        {generation.predictTimeSeconds === null
          ? "—"
          : `${generation.predictTimeSeconds.toFixed(1)}s`}
      </Mono>,
    ],
  ]
}

function ParamsTable({
  params,
  inputs,
}: {
  params: unknown
  inputs: { slotField: string; position: number; asset: AssetDto }[]
}) {
  const entries =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? Object.entries(params as Record<string, unknown>)
      : []

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This run recorded no parameters.
        </p>
      ) : (
        <Facts
          rows={entries.map(([field, value]) => [
            field,
            <Mono key={field}>
              {typeof value === "string" ? value : JSON.stringify(value)}
            </Mono>,
          ])}
        />
      )}

      {inputs.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">References</p>
          <ul className="flex flex-wrap gap-2">
            {inputs.map((input) => (
              <li
                key={`${input.slotField}:${input.asset.id}`}
                className="flex items-center gap-2 rounded-md border p-1.5"
              >
                {input.asset.thumbnailUrl ?? input.asset.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={input.asset.thumbnailUrl ?? input.asset.url!}
                    alt=""
                    className="size-8 rounded-sm object-cover"
                  />
                ) : null}
                <span className="text-xs">
                  {input.asset.label ??
                    input.asset.originalName ??
                    input.asset.kind}
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {input.slotField}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function DetailsPanel({
  generationId,
  open,
  onOpenChange,
  onBranch,
}: DetailsPanelProps) {
  const detail = useGeneration(open ? generationId : null)
  const lineage = useLineage(open ? generationId : null)
  const generation = detail.data?.generation

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">
            {generation?.modelSlug ?? "Run details"}
          </SheetTitle>
          <SheetDescription className="truncate">
            {generation?.prompt ?? "No prompt"}
          </SheetDescription>
        </SheetHeader>

        {detail.error ? (
          <p className="px-4 text-sm text-destructive">
            {detail.error.message}
          </p>
        ) : !generation ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Tabs defaultValue="provenance" className="min-h-0 flex-1 px-4 pb-4">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="provenance">Provenance</TabsTrigger>
              <TabsTrigger value="parameters">Parameters</TabsTrigger>
              <TabsTrigger value="request">Request</TabsTrigger>
              <TabsTrigger value="response">Response</TabsTrigger>
              <TabsTrigger value="lineage">Lineage</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pt-4">
              <TabsContent value="provenance">
                <div className="flex flex-col gap-5">
                  <Facts
                    rows={[
                      ["Provider", <Mono key="p">{generation.provider}</Mono>],
                      ["Model", <Mono key="m">{generation.modelSlug}</Mono>],
                      [
                        "Version",
                        <Mono key="v">{generation.modelVersion ?? "—"}</Mono>,
                      ],
                      ["Status", generation.status],
                      ["Created", timestamp(generation.createdAt)],
                      ["Started", timestamp(generation.startedAt)],
                      ["Finished", timestamp(generation.completedAt)],
                      [
                        "Provider job",
                        <Mono key="j">{generation.providerJobId ?? "—"}</Mono>,
                      ],
                      [
                        "Branched from",
                        <Mono key="parent">
                          {generation.parentGenerationId ?? "Not a branch"}
                        </Mono>,
                      ],
                      ...costRows(generation),
                    ]}
                  />

                  {generation.error ? (
                    <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                      {generation.error}
                    </p>
                  ) : null}

                  {onBranch ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => {
                        onBranch(generation.id)
                        onOpenChange(false)
                      }}
                    >
                      <HugeiconsIcon icon={GitBranchIcon} className="size-4" />
                      Branch from this run
                    </Button>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="parameters">
                <ParamsTable
                  params={parseJson(generation.paramsJson)}
                  inputs={detail.data?.inputs ?? []}
                />
              </TabsContent>

              <TabsContent value="request">
                <JsonBlock
                  label="Request"
                  value={parseJson(generation.requestJson)}
                />
              </TabsContent>

              <TabsContent value="response">
                <div className="flex flex-col gap-4">
                  <JsonBlock
                    label="Response"
                    value={parseJson(generation.responseJson)}
                  />
                  {logsOf(parseJson(generation.responseJson)) ? (
                    <JsonBlock
                      label="Logs"
                      value={logsOf(parseJson(generation.responseJson))}
                    />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="lineage">
                {lineage.data ? (
                  <LineageView lineage={lineage.data} />
                ) : lineage.error ? (
                  <p className="text-sm text-destructive">
                    {lineage.error.message}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Loading the branch history…
                  </p>
                )}
              </TabsContent>
            </div>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  )
}
