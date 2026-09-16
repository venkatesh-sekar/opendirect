/**
 * Electron-bound wiring for the AI helpers.
 *
 * Same split as `catalog.ts` / `catalog-service.ts`: `detect.ts`, `run-cli.ts`
 * and `helpers.ts` know nothing about Electron and are tested in plain Node;
 * this file supplies the four things only the desktop process can — the real
 * `execFile`/`spawn`, the open project (for the working directory and for
 * turning an asset id into a validated path), the `preferredAiTool` setting,
 * and the windows progress is pushed to.
 *
 * Detection runs once at startup and is cached. "Re-detect" in Settings is the
 * manual way back in, because installing a CLI while the app is open is a
 * perfectly ordinary thing to do.
 *
 * ⛔ No provider is called from here and no generation is ever started. The
 * result is returned to the renderer for the user to accept; main applies
 * nothing.
 */
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

import type {
  AiHelperId,
  AiProgress,
  AiResult,
  AiRunRequest,
  AiToolId,
  AiTools,
} from "@opendirect/contract"
import { BrowserWindow } from "electron"
import log from "electron-log/main"

import { emitIpcEvent } from "../ipc-registry"
import { getCurrentProject } from "../project-service"
import { realAssetPath } from "../project"
import { getAsset } from "../repo/assets"
import { getSettingsService } from "../settings-service"

import { DETECT_TIMEOUT_MS, detectLocalTools } from "./detect"
import {
  runHelper,
  type HelperOutcome,
  type ResolvedHelperRequest,
} from "./helpers"
import { AiToolError, runTool } from "./run-cli"

const execFile = promisify(execFileCallback)

let cached: AiTools | undefined
/** In-flight runs, so `ai:cancel` can reach the child process behind one. */
const running = new Map<string, AbortController>()

/** Every live window sees progress; a helper dialog may be open in any of them. */
function broadcast(progress: AiProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      emitIpcEvent(window.webContents, "ai:progress", progress)
    } catch (error) {
      log.warn("Could not push AI progress", error)
    }
  }
}

function preferredSetting(): AiToolId | null {
  try {
    return getSettingsService().settings.get().preferredAiTool
  } catch {
    // Settings are unavailable before the app is ready; detection still works.
    return null
  }
}

/**
 * Probes the PATH. Never throws — "neither CLI is installed" is a supported
 * configuration, and the renderer hides the whole AI surface for it.
 */
export async function detectAiTools(): Promise<AiTools> {
  cached = await detectLocalTools({
    execFile: (command, args) =>
      execFile(command, [...args], {
        timeout: DETECT_TIMEOUT_MS,
        windowsHide: true,
      }),
    preferred: preferredSetting(),
  })
  const found = (["claude", "codex"] as const)
    .filter((id) => cached?.[id].available)
    .join(", ")
  log.info(`Local AI CLIs: ${found || "none"}`)
  return cached
}

/** The cached detection, probing once on first use. */
export async function getAiTools(): Promise<AiTools> {
  if (!cached) return detectAiTools()
  // The preference can change without the binaries changing; re-resolving it
  // is cheaper (and more honest) than making the user press Re-detect.
  const preferred = preferredSetting()
  return {
    ...cached,
    preferred:
      preferred && cached[preferred].available ? preferred : cached.preferred,
  }
}

/** Runs detection at startup without ever failing the launch. */
export function initAiTools(): void {
  void detectAiTools().catch((error: unknown) => {
    log.warn("Could not detect local AI CLIs", error)
  })
}

/** Test/hot-reload seam: forgets the cached detection. */
export function resetAiTools(): void {
  cached = undefined
}

/**
 * Turns the renderer's request into one with real paths.
 *
 * The renderer names an **asset id**, never a path — same rule as
 * `shell:openAsset`. Main looks the row up and re-checks it against the
 * project root (lexically, then through `realpath`), so neither a stored
 * `../../etc/passwd` nor a symlink planted under `assets/` can become an
 * argument to a child process.
 */
async function resolveRequest(
  request: AiRunRequest["request"]
): Promise<ResolvedHelperRequest> {
  if (request.helper === "improve-prompt") {
    return {
      helper: "improve-prompt",
      prompt: request.prompt,
      modelName: request.modelName ?? null,
    }
  }
  if (request.helper === "suggest-shots") {
    return {
      helper: "suggest-shots",
      containerName: request.containerName,
      notes: request.notes ?? null,
    }
  }

  const current = getCurrentProject()
  if (!current) throw new Error("No project is open")
  const asset = getAsset(current.handle.db, request.assetId)
  if (!asset) throw new Error(`Asset ${request.assetId} was not found`)
  if (!asset.relPath) throw new Error("That asset has no file to read.")

  const assetPath = await realAssetPath(current.project, asset.relPath)
  return request.helper === "describe-reference"
    ? { helper: "describe-reference", assetPath }
    : { helper: "analyze-video", assetPath }
}

/**
 * What each helper is allowed to do inside the CLI.
 *
 * Only the two that read a file get `Read`; the text-only pair get nothing at
 * all. `run-cli.ts` turns this into an explicit allow/deny pair, so a prompt
 * that talks the model into wanting a shell finds there is no shell.
 */
const HELPER_TOOLS: Record<AiHelperId, readonly string[]> = {
  "improve-prompt": [],
  "suggest-shots": [],
  "describe-reference": ["Read"],
  "analyze-video": ["Read"],
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs one helper end to end: pick the tool, validate the paths, spawn, stream
 * progress, and hand the parsed answer back.
 */
export async function runAiHelper(input: AiRunRequest): Promise<AiResult> {
  const tools = await getAiTools()
  const chosen = input.tool ?? tools.preferred
  if (!chosen) {
    throw new Error(
      "No local AI CLI was found. Install `claude` or `codex` and press Re-detect in Settings."
    )
  }
  const status = tools[chosen]
  if (!status.available) {
    throw new Error(`The ${chosen} CLI is not on this machine's PATH.`)
  }

  const helper = input.request.helper
  const resolved = await resolveRequest(input.request)

  const controller = new AbortController()
  running.set(input.runId, controller)

  const emit = (
    state: AiProgress["state"],
    extra: { chunk?: string; message?: string } = {}
  ): void =>
    broadcast({
      runId: input.runId,
      helper,
      tool: chosen,
      state,
      chunk: extra.chunk ?? null,
      message: extra.message ?? null,
    })

  emit("started")
  const startedAt = Date.now()

  try {
    const outcome: HelperOutcome = await runHelper(resolved, async (prompt) => {
      // The prompt itself is never logged: it is the user's own work and can
      // carry a file path. Its length is enough to debug with.
      log.info(`AI helper ${helper} via ${chosen} (${prompt.length} chars)`)
      const run = await runTool(chosen, {
        prompt,
        command: status.path ?? chosen,
        cwd: getCurrentProject()?.project.path,
        allowedTools: HELPER_TOOLS[helper],
        signal: controller.signal,
        onChunk: (chunk) => emit("output", { chunk }),
      })
      return run.text
    })

    emit("finished")
    return {
      runId: input.runId,
      helper,
      tool: chosen,
      text: outcome.text,
      summary: outcome.summary,
      shots: outcome.shots,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    const canceled = error instanceof AiToolError && error.canceled
    emit(canceled ? "canceled" : "failed", { message: messageOf(error) })
    throw error instanceof Error ? error : new Error(messageOf(error))
  } finally {
    running.delete(input.runId)
  }
}

/** Kills the child behind a run. A run that already finished is a no-op. */
export function cancelAiRun(runId: string): void {
  running.get(runId)?.abort()
}

/** Cancels everything in flight — used on quit. */
export function stopAiRuns(): void {
  for (const controller of running.values()) controller.abort()
  running.clear()
}
