"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import {
  useChooseProjectRoot,
  useSettings,
  useUpdateSettings,
} from "@/lib/settings"

/** Clamps a numeric field to the contract's range before it is sent. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function GeneralSettingsForm() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const choose = useChooseProjectRoot()

  const data = settings.data

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          Where OpenDirect keeps your projects, and how hard it works the
          providers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-root">Project folder</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="project-root"
              readOnly
              className="min-w-64 flex-1 font-mono text-xs"
              placeholder="Not chosen yet"
              value={data?.projectRoot ?? ""}
            />
            <Button
              variant="outline"
              disabled={choose.isPending || update.isPending}
              onClick={() => {
                choose.mutate(undefined, {
                  onSuccess: ({ path }) => {
                    if (path) update.mutate({ projectRoot: path })
                  },
                })
              }}
            >
              Choose…
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="max-concurrent-jobs">Concurrent jobs</Label>
          <Input
            id="max-concurrent-jobs"
            type="number"
            min={1}
            max={8}
            className="w-32"
            value={data?.maxConcurrentJobs ?? 2}
            disabled={!data}
            onChange={(event) =>
              update.mutate({
                maxConcurrentJobs: clamp(Number(event.target.value), 1, 8),
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            How many generations run at once. Between 1 and 8.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="poll-interval">Poll interval (ms)</Label>
          <Input
            id="poll-interval"
            type="number"
            min={500}
            max={60000}
            step={500}
            className="w-32"
            value={data?.pollIntervalMs ?? 3000}
            disabled={!data}
            onChange={(event) =>
              update.mutate({
                pollIntervalMs: clamp(Number(event.target.value), 500, 60_000),
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            How often a running job is checked for progress.
          </p>
        </div>

        {settings.isError ? (
          <p className="text-xs text-destructive">{settings.error.message}</p>
        ) : null}
        {update.isError ? (
          <p className="text-xs text-destructive">{update.error.message}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
