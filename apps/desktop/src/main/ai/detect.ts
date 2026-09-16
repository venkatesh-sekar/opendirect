/**
 * Finding the user's own `claude` / `codex` binaries on PATH.
 *
 * OpenDirect ships no assistant. The AI helpers are the CLI the user already
 * installed and already pays for, so the first question is always "is it
 * there?" — and the honest answer when it is not is *nothing at all*: the
 * renderer hides every AI entry point when `preferred` comes back null, rather
 * than showing a greyed-out teaser for something the user never asked for.
 *
 * Kept free of `electron` (and of `child_process`) so the whole lookup is
 * unit tested against a stubbed `execFile`; `ai-service.ts` is the wiring.
 *
 * ⛔ Nothing here runs a prompt, and nothing here calls a provider. The only
 * two commands it issues are `which`/`where` and `--version`.
 */
import type { AiToolId, AiToolStatus, AiTools } from "@opendirect/contract"

export const AI_TOOL_IDS: readonly AiToolId[] = ["claude", "codex"]

/** How long a lookup or a version probe may take before it is given up on. */
export const DETECT_TIMEOUT_MS = 5000

/** Version strings are only ever a label; a runaway one is truncated. */
const MAX_VERSION_LENGTH = 80

export interface ExecFileLike {
  (
    command: string,
    args: readonly string[]
  ): Promise<{ stdout: string; stderr: string }>
}

export interface DetectDeps {
  execFile: ExecFileLike
  platform?: NodeJS.Platform
  now?: () => number
  /** The `preferredAiTool` setting, when one has been chosen. */
  preferred?: AiToolId | null
}

/** `where` on Windows, `which` everywhere else. */
export function lookupCommand(platform: NodeJS.Platform): string {
  return platform === "win32" ? "where" : "which"
}

/** The first line of a command's output, trimmed; null when there is none. */
function firstLine(stdout: string): string | null {
  const line = stdout.split(/\r?\n/, 1)[0]?.trim()
  return line ? line : null
}

async function probe(
  tool: AiToolId,
  deps: Required<Pick<DetectDeps, "execFile">> & { platform: NodeJS.Platform }
): Promise<AiToolStatus> {
  const absent: AiToolStatus = {
    id: tool,
    available: false,
    path: null,
    version: null,
  }

  let path: string | null
  try {
    const found = await deps.execFile(lookupCommand(deps.platform), [tool])
    path = firstLine(found.stdout)
  } catch {
    // "Not installed" is the ordinary case, not an error worth propagating.
    return absent
  }
  if (!path) return absent

  // A binary that is on PATH but cannot say its version is still usable, so a
  // failed probe costs the label and nothing else.
  let version: string | null = null
  try {
    const reported = await deps.execFile(path, ["--version"])
    version = firstLine(reported.stdout)?.slice(0, MAX_VERSION_LENGTH) ?? null
  } catch {
    version = null
  }

  return { id: tool, available: true, path, version }
}

/**
 * Which tool a helper uses when the user has not picked one for this run:
 * the preference when it is installed, otherwise whichever is, and null when
 * neither is — the flag the whole AI surface is hidden by.
 */
export function resolvePreferred(
  tools: Record<AiToolId, AiToolStatus>,
  preferred: AiToolId | null | undefined
): AiToolId | null {
  if (preferred && tools[preferred]?.available) return preferred
  return AI_TOOL_IDS.find((id) => tools[id].available) ?? null
}

/**
 * Probes both CLIs. Never throws: a machine with neither installed is a
 * supported configuration, and it comes back as two unavailable entries.
 */
export async function detectLocalTools(deps: DetectDeps): Promise<AiTools> {
  const platform = deps.platform ?? process.platform
  const [claude, codex] = await Promise.all(
    AI_TOOL_IDS.map((tool) =>
      probe(tool, { execFile: deps.execFile, platform })
    )
  )
  const tools = {
    claude: claude as AiToolStatus,
    codex: codex as AiToolStatus,
  }

  return {
    ...tools,
    preferred: resolvePreferred(tools, deps.preferred ?? null),
    detectedAt: (deps.now ?? Date.now)(),
  }
}
