/**
 * Spawning a local AI CLI, safely.
 *
 * Three rules hold this file together:
 *
 * 1. **No shell, ever.** The child is spawned with `shell: false` and an argv
 *    array, so a prompt containing `"; rm -rf ~` is a single argument and not
 *    a command. Nothing in here concatenates a command string, which is why
 *    there is no escaping in here either — escaping is what you need when you
 *    have already lost.
 * 2. **Every run ends.** A helper that hangs would hold a spinner open
 *    forever, so each run owns a deadline and an abort signal, and both kill
 *    the child rather than merely forgetting about it.
 * 3. **The prompt is never logged.** It is the user's own creative work and
 *    can carry a file path; only lengths and exit codes go to `electron-log`.
 *
 * `spawn` is injected so the whole thing is tested against a stub and against
 * a fake executable in `test/fixtures/ai/` — never against the real binaries.
 *
 * ⛔ Not a generation: this spends the user's CLI subscription, never a
 * provider credit, and it is only ever reached from an explicit menu click.
 */
import { spawn as nodeSpawn } from "node:child_process"

import type { AiToolId } from "@opendirect/contract"

/** A helper gets two minutes; past that it is a hang, not a slow answer. */
export const AI_RUN_TIMEOUT_MS = 120_000

/** How long a killed child has to die before it is killed harder. */
const KILL_GRACE_MS = 2000

/** Backstop so a child outliving our own timer is still reaped by Node. */
const SPAWN_TIMEOUT_MARGIN_MS = 5000

/** Captured output is bounded; a runaway CLI must not exhaust main's heap. */
const MAX_CAPTURED_CHARS = 2_000_000

export interface AiToolErrorInit {
  tool: AiToolId
  exitCode?: number | null
  stderr?: string
  timedOut?: boolean
  canceled?: boolean
}

/** Every failure a run can have, with the detail the UI shows attached. */
export class AiToolError extends Error {
  readonly tool: AiToolId
  readonly exitCode: number | null
  readonly stderr: string
  readonly timedOut: boolean
  readonly canceled: boolean

  constructor(message: string, init: AiToolErrorInit) {
    super(message)
    this.name = "AiToolError"
    this.tool = init.tool
    this.exitCode = init.exitCode ?? null
    this.stderr = init.stderr ?? ""
    this.timedOut = init.timedOut ?? false
    this.canceled = init.canceled ?? false
  }
}

/** The slice of a `ChildProcess` a run uses. */
export interface ChildStreamLike {
  on(event: "data", listener: (chunk: unknown) => void): unknown
}

export interface ChildLike {
  stdout: ChildStreamLike | null
  stderr: ChildStreamLike | null
  on(
    event: "close",
    listener: (code: number | null, signal: string | null) => void
  ): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface SpawnOptionsLike {
  /** Always `false`. Declared so a caller cannot quietly turn it on. */
  shell: false
  cwd?: string
  timeout?: number
  windowsHide?: boolean
  env?: NodeJS.ProcessEnv
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsLike
) => ChildLike

export interface RunOptions {
  prompt: string
  /** The resolved binary path from detection; defaults to the bare name. */
  command?: string
  /** The open project folder, so a CLI that reads files starts inside it. */
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Live output for the progress log. Never the prompt. */
  onChunk?: (chunk: string) => void
  spawn?: SpawnLike
}

export interface AiRunOutput {
  tool: AiToolId
  /** The answer, already unwrapped from whatever envelope the CLI used. */
  text: string
  stdout: string
  stderr: string
  durationMs: number
}

/**
 * `claude -p <prompt> --output-format json` — print mode, one JSON envelope.
 * Verified against Claude Code 2.1.x (`claude --help`).
 */
export function claudeArgs(prompt: string): string[] {
  return ["-p", prompt, "--output-format", "json"]
}

/**
 * `codex exec <prompt>` — the non-interactive subcommand. `--color never`
 * keeps ANSI escapes out of the captured text, `--skip-git-repo-check` lets it
 * run in a project folder that is not a git repository (most are not), and
 * `--sandbox read-only` is belt and braces: a helper is asked to *read* a
 * reference and answer, never to write anything. All four verified against
 * `codex exec --help` (codex-cli 0.154).
 */
export function codexArgs(prompt: string): string[] {
  return [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    prompt,
  ]
}

/**
 * The `--output-format json` envelope, which looks like
 * `{ type: "result", is_error: false, result: "…" }`.
 *
 * Anything that is not that envelope is returned verbatim: a future CLI
 * version changing its shape should degrade to "show the user what it said",
 * not to an error about a field name.
 */
export function parseClaudeResult(stdout: string): string {
  const raw = stdout.trim()
  if (!raw.startsWith("{")) return raw

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  if (typeof parsed !== "object" || parsed === null) return raw

  const envelope = parsed as {
    is_error?: unknown
    result?: unknown
    error?: unknown
  }
  const text =
    typeof envelope.result === "string"
      ? envelope.result
      : typeof envelope.error === "string"
        ? envelope.error
        : raw

  if (envelope.is_error === true) {
    throw new Error(text || "The CLI reported an error")
  }
  return text.trim()
}

interface ToolSpec {
  args: (prompt: string) => string[]
  parse: (stdout: string) => string
}

const TOOLS: Record<AiToolId, ToolSpec> = {
  claude: { args: claudeArgs, parse: parseClaudeResult },
  // `codex exec` prints the assistant's answer on stdout and nothing else.
  codex: { args: codexArgs, parse: (stdout) => stdout.trim() },
}

/** Keeps captured output bounded without losing the most recent part of it. */
function append(buffer: string, chunk: string): string {
  const next = buffer + chunk
  return next.length > MAX_CAPTURED_CHARS
    ? next.slice(next.length - MAX_CAPTURED_CHARS)
    : next
}

function runCli(tool: AiToolId, options: RunOptions): Promise<AiRunOutput> {
  const spec = TOOLS[tool]
  const spawn = (options.spawn ??
    (nodeSpawn as unknown as SpawnLike)) as SpawnLike
  const timeoutMs = options.timeoutMs ?? AI_RUN_TIMEOUT_MS
  const startedAt = Date.now()

  return new Promise<AiRunOutput>((resolve, reject) => {
    let child: ChildLike
    try {
      child = spawn(options.command ?? tool, spec.args(options.prompt), {
        // The whole point of this module. Never make it configurable.
        shell: false,
        cwd: options.cwd,
        timeout: timeoutMs + SPAWN_TIMEOUT_MARGIN_MS,
        windowsHide: true,
      })
    } catch (error) {
      reject(
        new AiToolError(
          `Could not start ${tool}: ${error instanceof Error ? error.message : String(error)}`,
          { tool }
        )
      )
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false
    let reason: "timeout" | "canceled" | null = null
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = (): void => {
      clearTimeout(deadline)
      if (graceTimer) clearTimeout(graceTimer)
      options.signal?.removeEventListener("abort", onAbort)
    }

    /** SIGTERM first so the CLI can tidy up; SIGKILL if it will not go. */
    const stop = (why: "timeout" | "canceled"): void => {
      if (settled || reason) return
      reason = why
      child.kill("SIGTERM")
      graceTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
      graceTimer.unref?.()
    }

    const deadline = setTimeout(() => stop("timeout"), timeoutMs)
    deadline.unref?.()

    function onAbort(): void {
      stop("canceled")
    }

    if (options.signal) {
      if (options.signal.aborted) queueMicrotask(onAbort)
      else options.signal.addEventListener("abort", onAbort, { once: true })
    }

    const capture = (
      stream: ChildStreamLike | null,
      onText: (text: string) => void
    ): void => {
      stream?.on("data", (chunk: unknown) => {
        const text = typeof chunk === "string" ? chunk : String(chunk)
        onText(text)
        options.onChunk?.(text)
      })
    }

    capture(child.stdout, (text) => {
      stdout = append(stdout, text)
    })
    capture(child.stderr, (text) => {
      stderr = append(stderr, text)
    })

    child.on("error", (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      const missing = (error as { code?: string }).code === "ENOENT"
      reject(
        new AiToolError(
          missing
            ? `The ${tool} CLI could not be run — is it still installed?`
            : `The ${tool} CLI failed to start: ${error.message}`,
          { tool, stderr }
        )
      )
    })

    child.on("close", (code: number | null) => {
      if (settled) return
      settled = true
      cleanup()

      if (reason === "canceled") {
        reject(
          new AiToolError(`${tool} was cancelled.`, {
            tool,
            stderr,
            canceled: true,
          })
        )
        return
      }
      if (reason === "timeout") {
        reject(
          new AiToolError(
            `${tool} did not answer within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
            { tool, stderr, timedOut: true }
          )
        )
        return
      }
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || "no output"
        reject(
          new AiToolError(`${tool} exited with code ${code}: ${detail}`, {
            tool,
            exitCode: code,
            stderr,
          })
        )
        return
      }

      try {
        resolve({
          tool,
          text: spec.parse(stdout),
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        })
      } catch (error) {
        reject(
          new AiToolError(
            error instanceof Error ? error.message : String(error),
            { tool, stderr }
          )
        )
      }
    })
  })
}

export function runClaude(options: RunOptions): Promise<AiRunOutput> {
  return runCli("claude", options)
}

export function runCodex(options: RunOptions): Promise<AiRunOutput> {
  return runCli("codex", options)
}

export function runTool(
  tool: AiToolId,
  options: RunOptions
): Promise<AiRunOutput> {
  return runCli(tool, options)
}
