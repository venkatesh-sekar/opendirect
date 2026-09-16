"use client"

import { useState } from "react"
import type { RecentProjectDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import { FolderOpenIcon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { invoke } from "@/lib/ipc"
import {
  useCreateProject,
  useOpenProject,
  useRecentProjects,
} from "@/hooks/use-containers"

function relativeDay(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString()
}

function RecentRow({
  project,
  onOpen,
  disabled,
}: {
  project: RecentProjectDto
  onOpen: (path: string) => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onOpen(project.path)}
      className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-50"
    >
      <span className="truncate text-sm">{project.name}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {relativeDay(project.lastOpenedAt)}
      </span>
    </button>
  )
}

export interface ProjectLauncherProps {
  /** Shown when the launcher is reachable from an already-open project. */
  onCancel?: () => void
}

/**
 * The screen before there is a project: open one, create one, or pick up where
 * you left off. No project means no database, so nothing else in the app can
 * render — this is the whole window until one is chosen.
 */
export function ProjectLauncher({ onCancel }: ProjectLauncherProps) {
  const recents = useRecentProjects()
  const openProject = useOpenProject()
  const createProject = useCreateProject()
  const [name, setName] = useState("")

  const busy = openProject.isPending || createProject.isPending
  const error = openProject.error ?? createProject.error

  const chooseFolder = async () => {
    const { path } = await invoke("project:choose")
    if (path) openProject.mutate(path)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">OpenDirect</h1>
          <p className="text-sm text-muted-foreground">
            A project is a folder on your disk. Everything you import or
            generate stays inside it.
          </p>
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = name.trim()
            if (trimmed) createProject.mutate(trimmed)
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New project name"
            aria-label="New project name"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            Create
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void chooseFolder()}
            disabled={busy}
          >
            <HugeiconsIcon icon={FolderOpenIcon} className="size-4" />
            Open
          </Button>
        </form>

        {error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <h2 className="px-2 text-xs text-muted-foreground">Recent</h2>
          {recents.data && recents.data.length > 0 ? (
            recents.data.map((project) => (
              <RecentRow
                key={project.id}
                project={project}
                disabled={busy}
                onOpen={(path) => openProject.mutate(path)}
              />
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Nothing opened yet.
            </p>
          )}
        </div>

        {onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="self-start"
          >
            Back to the current project
          </Button>
        ) : null}
      </div>
    </main>
  )
}
