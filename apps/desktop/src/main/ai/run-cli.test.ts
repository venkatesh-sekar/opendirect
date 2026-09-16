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
  type SpawnLike,
} from "./run-cli"

/**
 * The fixture is a real executable, so the spawn path itself is exercised —
 * and it is a fake, so no test can ever reach the real `claude` or `codex`.
 * Resolved from the vitest root, which is the repo root.
 */
const FAKE_CLI = path.join(process.cwd(), "test/fixtures/ai/fake-cli.mjs")

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
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
  it("asks claude for a JSON envelope in print mode", () => {
    expect(claudeArgs("a prompt")).toEqual([
      "-p",
      "a prompt",
      "--output-format",
      "json",
    ])
  })

  it("runs codex non-interactively", () => {
    expect(codexArgs("a prompt")).toContain("exec")
    expect(codexArgs("a prompt").at(-1)).toBe("a prompt")
  })

  it("keeps a shell-hostile prompt in one argv element", () => {
    const nasty = '"; rm -rf ~ #`whoami`$(id)'
    expect(claudeArgs(nasty)).toContain(nasty)
    expect(codexArgs(nasty)).toContain(nasty)
    // Nothing is quoted or escaped, because nothing is ever concatenated.
    expect(claudeArgs(nasty).join(" ")).not.toContain("\\")
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
    expect(args).toEqual(["-p", "make it better", "--output-format", "json"])
    expect(args).toContain("make it better")
    expect(options.shell).toBe(false)
    expect(options.cwd).toBe("/tmp/p")

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
  it("parses the claude envelope the fixture prints", async () => {
    const result = await runTool("claude", {
      prompt: "hello there",
      command: FAKE_CLI,
    })

    expect(result.text).toBe("improved: hello there")
    expect(result.stderr).toBe("")
  })

  it("passes the prompt as one argv element, unmangled by a shell", async () => {
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
