"use client"

/**
 * The status strip along the bottom of the window.
 *
 * It answers the three questions nothing else on screen answers: is the app
 * still working (the job count, and the way into the job list), is there a new
 * version, and is there a local AI CLI backing the ✨ menus. Everything here is
 * ambient — it never takes focus and it never blocks — which is why the only
 * interactive things on it are the job sheet's trigger and, when an update has
 * actually been downloaded, a restart button.
 */
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon, DownloadCircle01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { useAiTools } from "@/hooks/use-ai"
import { useAppInfo } from "@/hooks/use-app-info"
import { useUpdater, type UpdaterStatus } from "@/hooks/use-updater"

import { JobList } from "@/components/jobs/job-list"

/** What the strip says about an update, or null when it should stay quiet. */
export function updaterLabel(status: UpdaterStatus | null): string | null {
  if (!status) return null
  switch (status.state) {
    case "available":
      return `Downloading ${status.version}…`
    case "downloading":
      return `Downloading update — ${status.percent}%`
    case "ready":
      return `Update ${status.version} ready`
    // The message goes in a tooltip, never the strip: electron-updater's can
    // carry a whole HTTP response and would wrap over the window.
    case "error":
      return "Couldn't check for updates"
    // "Up to date" is not news; a strip that says it forever is noise.
    case "not-available":
      return null
  }
}

/** An updater error's first line, short enough for a tooltip. */
export function updaterErrorDetail(message: string): string {
  const firstLine = message.split("\n")[0]?.trim() ?? ""
  return firstLine.length > 200 ? `${firstLine.slice(0, 199)}…` : firstLine
}

/** The installed CLIs, named — or nothing at all when there are none. */
export function aiToolsLabel(
  tools: {
    claude: { available: boolean }
    codex: { available: boolean }
  } | null
): string | null {
  if (!tools) return null
  const found = [
    tools.claude.available ? "claude" : null,
    tools.codex.available ? "codex" : null,
  ].filter((name): name is string => name !== null)
  return found.length > 0 ? found.join(" · ") : null
}

export function StatusBar() {
  const updater = useUpdater()
  const aiTools = useAiTools()
  const info = useAppInfo()
  const [restarting, setRestarting] = useState(false)

  const update = updaterLabel(updater.status)
  const ai = aiToolsLabel(aiTools.data ?? null)

  return (
    <div
      role="status"
      aria-label="Status"
      data-testid="status-bar"
      className="flex items-center gap-3 border-t px-2 py-1 text-xs text-muted-foreground"
    >
      {info.data ? (
        <span className="font-mono" data-testid="app-version">
          v{info.data.version}
        </span>
      ) : null}

      {ai ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
                {ai}
              </span>
            }
          />
          <TooltipContent>
            AI helpers run on your own CLI subscription — never a paid
            generation.
          </TooltipContent>
        </Tooltip>
      ) : null}

      {update && updater.status?.state === "error" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={DownloadCircle01Icon}
                  className="size-3.5"
                />
                {update}
              </span>
            }
          />
          <TooltipContent className="max-w-sm">
            {updaterErrorDetail(updater.status.message)}
          </TooltipContent>
        </Tooltip>
      ) : update ? (
        <span className="inline-flex items-center gap-1.5">
          <HugeiconsIcon icon={DownloadCircle01Icon} className="size-3.5" />
          {update}
          {updater.status?.state === "ready" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6"
              disabled={restarting}
              onClick={() => {
                setRestarting(true)
                void updater.install().finally(() => setRestarting(false))
              }}
            >
              {restarting ? "Restarting…" : "Restart to update"}
            </Button>
          ) : null}
        </span>
      ) : null}

      <div className="ml-auto">
        <JobList />
      </div>
    </div>
  )
}
