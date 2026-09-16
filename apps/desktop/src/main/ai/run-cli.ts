/**
 * Spawning a local AI CLI, safely.
 *
 * Three rules hold this file together:
 *
 * 1. **No shell, and no prompt in argv.** The child is spawned with
 *    `shell: false` and an argv array of flags only; the prompt itself goes
 *    down stdin, which both CLIs read. Nothing in here concatenates a command
 *    string, which is why there is no escaping in here either — escaping is
 *    what you need when you have already lost. Stdin also means a 300KB prompt
 *    is not an `E2BIG` (or a 32KB Windows command line).
 * 2. **Every run ends.** A helper that hangs would hold a spinner open
 *    forever, so each run owns a deadline and an abort signal, and both kill
 *    the child rather than merely forgetting about it.
 * 3. **The prompt is never logged.** It is the user's own creative work and
 *    can carry a file path; only lengths and exit codes go to `electron-log`.
 * 4. **The child gets a scrubbed environment and no tools it does not need.**
 *    `sanitizeEnv` strips the provider API keys — in development they are in
 *    `process.env` from `.env.local`, and a helper has no business seeing the
 *    credentials that spend money — and `claude` is pinned to a non-escalating
 *    permission mode with an explicit tool allowlist, so no Write/Edit/Bash
 *    path exists from a prompt the user was only asking to improve.
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

/** The slice of a child's stdin the prompt is written to. */
export interface ChildStdinLike {
  write(chunk: string): unknown
  end(): unknown
  on?(event: "error", listener: (error: Error) => void): unknown
}

export interface ChildLike {
  stdout: ChildStreamLike | null
  stderr: ChildStreamLike | null
  stdin?: ChildStdinLike | null
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
  /** Always the scrubbed environment — never an inherited `process.env`. */
  env: NodeJS.ProcessEnv
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
  /** What the helper needs to do its job; nothing else is permitted. */
  allowedTools?: readonly string[]
  /** The environment to scrub and hand over. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
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
 * Environment variables a child CLI must never see.
 *
 * In development `loadDevEnv()` puts `REPLICATE_API_TOKEN` and
 * `OPENROUTER_API_KEY` into `process.env`, and an inherited environment would
 * hand both to a process that is only being asked to rewrite a sentence. The
 * rule is therefore a denylist by *shape* — anything that looks like a
 * credential goes — with one exception per tool: the CLI's own authentication,
 * which the user may well be relying on to run it at all.
 *
 * `claude` keeps `ANTHROPIC_*` / `CLAUDE_*`, `codex` keeps `OPENAI_*` /
 * `CODEX_*`, and neither gets the other's. Everything non-secret (PATH, HOME,
 * locale, TMPDIR…) is passed through untouched, because a CLI with no PATH is
 * a CLI that does not start.
 *
 * The suffixes are deliberately the *bare* ones — `_TOKEN`, `_KEY`, `_SECRET`
 * — not just the `_API_`-prefixed spellings, because plenty of real
 * credentials are named without an `API` in the middle (`GITHUB_TOKEN`,
 * `HF_TOKEN`, `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`). Matching the narrower
 * forms only would have handed those straight to a child process. The cost of
 * the wider net is the odd innocent variable ending in `_KEY` being dropped;
 * that is a variable a prompt-rewriting CLI has no use for anyway.
 */
const SECRET_SHAPED =
  /(_TOKEN|_KEY|_SECRET|_PASSWORD|_PASSPHRASE|_CREDENTIALS)$/

/** Prefixes each tool is allowed to keep, because they are its own login. */
const TOOL_OWN_ENV: Record<AiToolId, RegExp> = {
  claude: /^(ANTHROPIC_|CLAUDE_)/,
  codex: /^(OPENAI_|CODEX_)/,
}

export function sanitizeEnv(
  tool: AiToolId,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const own = TOOL_OWN_ENV[tool]
  const other = Object.entries(TOOL_OWN_ENV)
    .filter(([id]) => id !== tool)
    .map(([, pattern]) => pattern)

  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (other.some((pattern) => pattern.test(name))) continue
    if (own.test(name)) {
      env[name] = value
      continue
    }
    if (SECRET_SHAPED.test(name)) continue
    env[name] = value
  }
  return env
}

/**
 * Tools `claude` is explicitly denied, whatever else it decides it wants.
 *
 * A helper reads a file the user pointed at and answers in text. Nothing in
 * that job description needs a shell, an editor or the network, so the whole
 * writing half of the toolset is named and refused rather than left to the
 * permission prompt nobody is there to answer.
 */
const CLAUDE_DENIED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Task",
  "WebFetch",
  "WebSearch",
  "KillShell",
  "Read",
]

export interface ToolPolicy {
  /** What the helper genuinely needs — `Read` for the file-reading two. */
  allowedTools: readonly string[]
}

/**
 * `claude -p --output-format json` — print mode, one JSON envelope, prompt on
 * stdin. `--permission-mode plan` is the only mode of the six that cannot
 * escalate (the others are `acceptEdits`, `auto`, `bypassPermissions`,
 * `manual`, `dontAsk`), and the allow/deny lists pin the toolset on top of it.
 * All three flags verified against Claude Code 2.1.273 (`claude --help`).
 */
export function claudeArgs(policy: ToolPolicy): string[] {
  const args = ["-p", "--output-format", "json", "--permission-mode", "plan"]
  if (policy.allowedTools.length > 0) {
    args.push("--allowedTools", policy.allowedTools.join(","))
  }
  const denied = CLAUDE_DENIED_TOOLS.filter(
    (tool) => !policy.allowedTools.includes(tool)
  )
  args.push("--disallowedTools", denied.join(","))
  return args
}

/**
 * `codex exec -` — the non-interactive subcommand, prompt on stdin (`-` is
 * codex's own spelling for that). `--color never` keeps ANSI escapes out of
 * the captured text, `--skip-git-repo-check` lets it run in a project folder
 * that is not a git repository (most are not), and `--sandbox read-only` is
 * codex's equivalent of claude's denied tool list: a helper reads a reference
 * and answers, and may never write. All verified against `codex exec --help`
 * (codex-cli 0.154).
 */
export function codexArgs(): string[] {
  return [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-",
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
  args: (policy: ToolPolicy) => string[]
  parse: (stdout: string) => string
}

const TOOLS: Record<AiToolId, ToolSpec> = {
  claude: { args: claudeArgs, parse: parseClaudeResult },
  // `codex exec` prints the assistant's answer on stdout and nothing else,
  // and its own `--sandbox read-only` stands in for a tool allowlist.
  codex: { args: () => codexArgs(), parse: (stdout) => stdout.trim() },
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
      child = spawn(
        options.command ?? tool,
        spec.args({ allowedTools: options.allowedTools ?? [] }),
        {
          // The whole point of this module. Never make it configurable.
          shell: false,
          cwd: options.cwd,
          timeout: timeoutMs + SPAWN_TIMEOUT_MARGIN_MS,
          windowsHide: true,
          // Never inherited: the provider keys live in `process.env` in dev.
          env: sanitizeEnv(tool, options.env),
        }
      )
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

    /**
     * The prompt, down the pipe. A closed stdin (the child died before it
     * read anything) surfaces as the `close`/`error` the run is already
     * waiting for, so an EPIPE here is swallowed rather than raced.
     */
    try {
      child.stdin?.on?.("error", () => {})
      child.stdin?.write(options.prompt)
      child.stdin?.end()
    } catch {
      // Same reasoning: the exit handler below reports what actually happened.
    }

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
