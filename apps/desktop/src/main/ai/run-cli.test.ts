import { EventEmitter } from "node:events"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AI_RUN_TIMEOUT_MS,
  AiToolError,
  claudeArgs,
  codexArgs,
  parseClaudeResult,
  runClaude,
  runCodex,
  runTool,
  sanitizeEnv,
  type SpawnLike,
} from "./run-cli"

/**
 * The fixture is a real executable, so the spawn path itself is exercised —
 * and it is a fake, so no test can ever reach the real `claude` or `codex`.
 * Resolved from the vitest root, which is the repo root.
 */
const FAKE_CLI = path.join(process.cwd(), "test/fixtures/ai/fake-cli.mjs")

class FakeStdin {
  written: string[] = []
  ended = false
  write = vi.fn((chunk: string) => {
    this.written.push(chunk)
    return true
  })
  end = vi.fn(() => {
    this.ended = true
  })
  on = vi.fn()
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = new FakeStdin()
  kill = vi.fn((signal?: string) => {
    this.killedWith = signal ?? "SIGTERM"
    return true
  })
  killedWith: string | null = null
}

/** A `spawn` stub that hands back a child the test drives by hand. */
function stubSpawn(): {
  spawn: SpawnLike & ReturnType<typeof vi.fn>
  child: FakeChild
} {
  const child = new FakeChild()
  const spawn = vi.fn(() => child) as unknown as SpawnLike &
    ReturnType<typeof vi.fn>
  return { spawn, child }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("argument building", () => {
  it("asks claude for a JSON envelope in print mode, reading the prompt from stdin", () => {
    const args = claudeArgs({ allowedTools: [] })

    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"])
    // No prompt in argv at all: it goes down the pipe.
    expect(args).not.toContain("--prompt")
  })

  it("never lets claude escalate its own permissions", () => {
    const args = claudeArgs({ allowedTools: [] })
    const mode = args[args.indexOf("--permission-mode") + 1]

    expect(args).toContain("--permission-mode")
    expect(mode).toBe("plan")
    expect(mode).not.toBe("bypassPermissions")
    expect(mode).not.toBe("acceptEdits")
  })

  it("denies every writing tool, and Read too when the helper needs no file", () => {
    const denied =
      claudeArgs({ allowedTools: [] })[
        claudeArgs({ allowedTools: [] }).indexOf("--disallowedTools") + 1
      ] ?? ""

    for (const tool of ["Bash", "Edit", "Write", "NotebookEdit", "Read"]) {
      expect(denied.split(",")).toContain(tool)
    }
    expect(claudeArgs({ allowedTools: [] })).not.toContain("--allowedTools")
  })

  it("allows exactly Read for a helper that must open a reference", () => {
    const args = claudeArgs({ allowedTools: ["Read"] })
    const allowed = args[args.indexOf("--allowedTools") + 1]
    const denied = args[args.indexOf("--disallowedTools") + 1] ?? ""

    expect(allowed).toBe("Read")
    expect(denied.split(",")).not.toContain("Read")
    expect(denied.split(",")).toContain("Bash")
    expect(denied.split(",")).toContain("Write")
  })

  it("runs codex non-interactively, reading the prompt from stdin", () => {
    const args = codexArgs()

    expect(args).toContain("exec")
    expect(args).toContain("--sandbox")
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only")
    // `-` is codex's own "the prompt is on stdin".
    expect(args.at(-1)).toBe("-")
  })

  it("puts no prompt text in argv for either tool", () => {
    const nasty = '"; rm -rf ~ #`whoami`$(id)'
    expect(claudeArgs({ allowedTools: [] })).not.toContain(nasty)
    expect(codexArgs()).not.toContain(nasty)
  })
})

describe("sanitizeEnv", () => {
  const dirty = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    LANG: "en_GB.UTF-8",
    REPLICATE_API_TOKEN: "r8_secret",
    OPENROUTER_API_KEY: "sk-or-secret",
    SOME_OTHER_API_KEY: "nope",
    STRIPE_SECRET: "nope",
    ANTHROPIC_API_KEY: "sk-ant",
    OPENAI_API_KEY: "sk-oai",
    CLAUDE_CODE_SOMETHING: "fine",
    CODEX_HOME: "/home/dev/.codex",
  }

  it("keeps the environment a CLI needs to run at all", () => {
    const env = sanitizeEnv("claude", dirty)

    expect(env.PATH).toBe("/usr/bin")
    expect(env.HOME).toBe("/home/dev")
    expect(env.LANG).toBe("en_GB.UTF-8")
  })

  it("never hands a provider key to a child process", () => {
    for (const tool of ["claude", "codex"] as const) {
      const env = sanitizeEnv(tool, dirty)
      expect(env.REPLICATE_API_TOKEN).toBeUndefined()
      expect(env.OPENROUTER_API_KEY).toBeUndefined()
      expect(env.SOME_OTHER_API_KEY).toBeUndefined()
      expect(env.STRIPE_SECRET).toBeUndefined()
    }
  })

  it("leaves each CLI its own credentials and takes away the other's", () => {
    const forClaude = sanitizeEnv("claude", dirty)
    expect(forClaude.ANTHROPIC_API_KEY).toBe("sk-ant")
    expect(forClaude.CLAUDE_CODE_SOMETHING).toBe("fine")
    expect(forClaude.OPENAI_API_KEY).toBeUndefined()

    const forCodex = sanitizeEnv("codex", dirty)
    expect(forCodex.OPENAI_API_KEY).toBe("sk-oai")
    expect(forCodex.CODEX_HOME).toBe("/home/dev/.codex")
    expect(forCodex.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe("parseClaudeResult", () => {
  it("returns the result text out of the JSON envelope", () => {
    expect(
      parseClaudeResult(
        JSON.stringify({ type: "result", is_error: false, result: "hello" })
      )
    ).toBe("hello")
  })

  it("falls back to the raw output when it is not the envelope", () => {
    expect(parseClaudeResult("just words\n")).toBe("just words")
  })

  it("throws when the envelope reports an error", () => {
    expect(() =>
      parseClaudeResult(
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "rate limited",
        })
      )
    ).toThrow(/rate limited/)
  })
})

describe("runClaude", () => {
  it("spawns claude with an argv array and no shell", async () => {
    const { spawn, child } = stubSpawn()
    const running = runClaude({
      prompt: "make it better",
      spawn,
      cwd: "/tmp/p",
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawn.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ]
    expect(command).toBe("claude")
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"])
    expect(args).not.toContain("make it better")
    expect(options.shell).toBe(false)
    expect(options.cwd).toBe("/tmp/p")
    // The prompt goes down the pipe, so its length is not an argv limit.
    expect(child.stdin.written.join("")).toBe("make it better")
    expect(child.stdin.ended).toBe(true)

    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "result", result: "better prompt" }))
    )
    child.emit("close", 0, null)

    await expect(running).resolves.toMatchObject({
      tool: "claude",
      text: "better prompt",
    })
  })

  it("streams stdout to onChunk as it arrives", async () => {
    const { spawn, child } = stubSpawn()
    const chunks: string[] = []
    const running = runClaude({
      prompt: "p",
      spawn,
      onChunk: (c) => chunks.push(c),
    })

    child.stdout.emit("data", Buffer.from("one"))
    child.stderr.emit("data", Buffer.from("two"))
    child.emit("close", 0, null)
    await running

    expect(chunks).toEqual(["one", "two"])
  })

  it("rejects with an AiToolError carrying stderr on a non-zero exit", async () => {
    const { spawn, child } = stubSpawn()
    const running = runClaude({ prompt: "p", spawn })

    child.stderr.emit("data", Buffer.from("not logged in"))
    child.emit("close", 2, null)

    const error = await running.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).exitCode).toBe(2)
    expect((error as AiToolError).stderr).toContain("not logged in")
    expect((error as AiToolError).message).toContain("not logged in")
  })

  it("reports a missing binary as an AiToolError rather than an ENOENT", async () => {
    const { spawn, child } = stubSpawn()
    const running = runClaude({ prompt: "p", spawn })

    child.emit(
      "error",
      Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })
    )

    const error = await running.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).message).toMatch(/claude/)
  })

  it("kills the child and reports a timeout after the deadline", async () => {
    vi.useFakeTimers()
    const { spawn, child } = stubSpawn()
    const running = runClaude({ prompt: "p", spawn })
    const settled = running.catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(AI_RUN_TIMEOUT_MS + 1)
    child.emit("close", null, "SIGTERM")

    const error = await settled
    expect(child.kill).toHaveBeenCalled()
    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).timedOut).toBe(true)
    expect((error as AiToolError).message).toMatch(/120/)
  })

  it("kills the child when the caller aborts", async () => {
    const { spawn, child } = stubSpawn()
    const controller = new AbortController()
    const running = runClaude({ prompt: "p", spawn, signal: controller.signal })
    const settled = running.catch((e: unknown) => e)

    controller.abort()
    child.emit("close", null, "SIGTERM")

    const error = await settled
    expect(child.kill).toHaveBeenCalled()
    expect((error as AiToolError).canceled).toBe(true)
  })
})

describe("runCodex", () => {
  it("returns stdout as the text", async () => {
    const { spawn, child } = stubSpawn()
    const running = runCodex({ prompt: "p", spawn })

    expect((spawn.mock.calls[0] as unknown[])[0]).toBe("codex")
    child.stdout.emit("data", Buffer.from("  a shot list  \n"))
    child.emit("close", 0, null)

    await expect(running).resolves.toMatchObject({
      tool: "codex",
      text: "a shot list",
    })
  })
})

describe("runTool against a real fake executable", () => {
  it("keeps the provider API keys away from the child", async () => {
    const result = await runTool("claude", {
      prompt: "env check",
      command: FAKE_CLI,
      env: {
        // The fixture's shebang needs a PATH to find node; everything else
        // here is a secret the child must not come back reporting.
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        PATH: process.env.PATH,
        REPLICATE_API_TOKEN: "r8_secret",
        OPENROUTER_API_KEY: "sk-or-secret",
        ANTHROPIC_API_KEY: "sk-ant",
      },
    })

    expect(JSON.parse(result.text)).toEqual({
      REPLICATE_API_TOKEN: false,
      OPENROUTER_API_KEY: false,
      ANTHROPIC_API_KEY: true,
      OPENAI_API_KEY: false,
      PATH: true,
    })
  })

  it("carries a prompt far longer than an argv entry allows", async () => {
    const huge = `a very long prompt ${"x".repeat(300_000)}`
    const result = await runTool("codex", { prompt: huge, command: FAKE_CLI })

    expect(result.text).toBe(`codex saw: ${huge}`)
  })

  it("parses the claude envelope the fixture prints", async () => {
    const result = await runTool("claude", {
      prompt: "hello there",
      command: FAKE_CLI,
    })

    expect(result.text).toBe("improved: hello there")
    expect(result.stderr).toBe("")
  })

  it("passes the prompt through stdin, unmangled by a shell", async () => {
    const nasty = '"; echo pwned > /tmp/pwned #'
    const result = await runTool("codex", { prompt: nasty, command: FAKE_CLI })

    expect(result.text).toBe(`codex saw: ${nasty}`)
  })

  it("surfaces a failing exit code with its stderr", async () => {
    const error = await runTool("claude", {
      prompt: "please fail",
      command: FAKE_CLI,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).stderr).toContain("fake failure")
  })

  it("kills a hanging process when the deadline passes", async () => {
    const error = await runTool("claude", {
      prompt: "please hang",
      command: FAKE_CLI,
      timeoutMs: 150,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).timedOut).toBe(true)
  })

  it("kills a hanging process when the caller cancels", async () => {
    const controller = new AbortController()
    const running = runTool("codex", {
      prompt: "please hang",
      command: FAKE_CLI,
      signal: controller.signal,
    }).catch((e: unknown) => e)

    setTimeout(() => controller.abort(), 50)
    const error = await running

    expect(error).toBeInstanceOf(AiToolError)
    expect((error as AiToolError).canceled).toBe(true)
  })
})
