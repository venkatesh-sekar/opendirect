import { describe, expect, it, vi } from "vitest"

import { detectLocalTools, lookupCommand, resolvePreferred } from "./detect"

/** A `which`/`--version` stub built from a map of what is "installed". */
function fakeExec(installed: Record<string, string | Error>) {
  return vi.fn(async (command: string, args: readonly string[]) => {
    if (command === "which" || command === "where") {
      const name = args[0] as string
      const found = installed[name]
      if (found === undefined) throw new Error(`no ${name} in PATH`)
      if (found instanceof Error) throw found
      return { stdout: `${found}\n`, stderr: "" }
    }
    // Anything else is `<path> --version`.
    return { stdout: `1.2.3 (${command})\n`, stderr: "" }
  })
}

describe("lookupCommand", () => {
  it("uses which on posix and where on windows", () => {
    expect(lookupCommand("darwin")).toBe("which")
    expect(lookupCommand("linux")).toBe("which")
    expect(lookupCommand("win32")).toBe("where")
  })
})

describe("detectLocalTools", () => {
  it("resolves both binaries on PATH with their versions", async () => {
    const execFile = fakeExec({
      claude: "/usr/local/bin/claude",
      codex: "/usr/local/bin/codex",
    })
    const tools = await detectLocalTools({
      execFile,
      platform: "linux",
      now: () => 1000,
    })

    expect(tools.claude).toEqual({
      id: "claude",
      available: true,
      path: "/usr/local/bin/claude",
      version: "1.2.3 (/usr/local/bin/claude)",
    })
    expect(tools.codex.available).toBe(true)
    expect(tools.detectedAt).toBe(1000)
    expect(execFile).toHaveBeenCalledWith("which", ["claude"])
  })

  it("looks binaries up with `where` on windows", async () => {
    const execFile = fakeExec({ claude: "C:\\bin\\claude.cmd" })
    const tools = await detectLocalTools({ execFile, platform: "win32" })

    expect(execFile).toHaveBeenCalledWith("where", ["claude"])
    expect(tools.claude.path).toBe("C:\\bin\\claude.cmd")
  })

  it("takes only the first line when `where` lists several matches", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "C:\\a\\claude.cmd\r\nC:\\b\\claude.cmd\r\n",
      stderr: "",
    }))
    const tools = await detectLocalTools({ execFile, platform: "win32" })

    expect(tools.claude.path).toBe("C:\\a\\claude.cmd")
  })

  it("reports a tool as unavailable, without throwing, when it is absent", async () => {
    const execFile = fakeExec({ codex: "/usr/local/bin/codex" })
    const tools = await detectLocalTools({ execFile, platform: "linux" })

    expect(tools.claude).toEqual({
      id: "claude",
      available: false,
      path: null,
      version: null,
    })
    expect(tools.codex.available).toBe(true)
    expect(tools.preferred).toBe("codex")
  })

  it("returns both unavailable, and no preference, when neither is installed", async () => {
    const tools = await detectLocalTools({
      execFile: fakeExec({}),
      platform: "linux",
    })

    expect(tools.claude.available).toBe(false)
    expect(tools.codex.available).toBe(false)
    expect(tools.preferred).toBeNull()
  })

  it("still counts a tool as available when --version fails", async () => {
    const execFile = vi.fn(async (command: string) => {
      if (command === "which") return { stdout: "/bin/claude\n", stderr: "" }
      throw new Error("version check exploded")
    })
    const tools = await detectLocalTools({ execFile, platform: "linux" })

    expect(tools.claude.available).toBe(true)
    expect(tools.claude.version).toBeNull()
  })

  it("honours the preferred setting when that tool is installed", async () => {
    const execFile = fakeExec({
      claude: "/bin/claude",
      codex: "/bin/codex",
    })
    const tools = await detectLocalTools({
      execFile,
      platform: "linux",
      preferred: "codex",
    })

    expect(tools.preferred).toBe("codex")
  })
})

describe("resolvePreferred", () => {
  const up = {
    id: "claude",
    available: true,
    path: "/c",
    version: null,
  } as const
  const down = {
    id: "codex",
    available: false,
    path: null,
    version: null,
  } as const

  it("falls back to the installed tool when the preferred one is missing", () => {
    expect(resolvePreferred({ claude: up, codex: down }, "codex")).toBe(
      "claude"
    )
  })

  it("is null when nothing is installed", () => {
    expect(
      resolvePreferred(
        { claude: { ...up, available: false }, codex: down },
        "claude"
      )
    ).toBeNull()
  })

  it("defaults to claude when both are installed and nothing is preferred", () => {
    expect(
      resolvePreferred(
        { claude: up, codex: { ...down, available: true } },
        null
      )
    ).toBe("claude")
  })
})
