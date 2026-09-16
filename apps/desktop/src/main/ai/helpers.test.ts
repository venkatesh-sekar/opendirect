import { describe, expect, it, vi } from "vitest"

import { helperPrompt, runHelper } from "./helpers"

/** Captures the prompt the helper built and answers with a canned reply. */
function runner(reply: string) {
  const calls: string[] = []
  const run = vi.fn(async (prompt: string) => {
    calls.push(prompt)
    return reply
  })
  return { run, calls }
}

describe("helperPrompt", () => {
  it("names the model the improved prompt is for", () => {
    const prompt = helperPrompt({
      helper: "improve-prompt",
      prompt: "a cat",
      modelName: "Seedance 2.5",
    })

    expect(prompt).toContain("a cat")
    expect(prompt).toContain("Seedance 2.5")
    // The CLI must answer with the prompt and nothing else.
    expect(prompt.toLowerCase()).toContain("only")
  })

  it("attaches the validated file path for the reference helpers", () => {
    const describe_ = helperPrompt({
      helper: "describe-reference",
      assetPath: "/projects/Hotel/assets/2026/09/a.png",
    })
    const analyze = helperPrompt({
      helper: "analyze-video",
      assetPath: "/projects/Hotel/assets/2026/09/b.mp4",
    })

    expect(describe_).toContain("/projects/Hotel/assets/2026/09/a.png")
    expect(analyze).toContain("/projects/Hotel/assets/2026/09/b.mp4")
    expect(analyze).toContain("summary")
    expect(analyze).toContain("shots")
  })

  it("carries the container and its notes into the shot list", () => {
    const prompt = helperPrompt({
      helper: "suggest-shots",
      containerName: "Lobby",
      notes: "night, rain",
    })

    expect(prompt).toContain("Lobby")
    expect(prompt).toContain("night, rain")
  })

  it("omits the notes line when there are none", () => {
    const prompt = helperPrompt({
      helper: "suggest-shots",
      containerName: "Lobby",
      notes: null,
    })

    expect(prompt).toContain("Lobby")
    expect(prompt).not.toContain("Notes:")
  })
})

describe("runHelper", () => {
  it("returns the rewritten prompt, unwrapped from its code fence", async () => {
    const { run, calls } = runner("```\nA cat, slow dolly in.\n```")
    const outcome = await runHelper(
      { helper: "improve-prompt", prompt: "a cat", modelName: null },
      run
    )

    expect(outcome.text).toBe("A cat, slow dolly in.")
    expect(outcome.shots).toEqual([])
    expect(calls[0]).toContain("a cat")
  })

  it("returns a description paragraph as one block of prose", async () => {
    const { run } = runner("  A tall red door,\n  lit from the left.  ")
    const outcome = await runHelper(
      { helper: "describe-reference", assetPath: "/p/a.png" },
      run
    )

    expect(outcome.text).toBe("A tall red door,\nlit from the left.")
    expect(outcome.summary).toBeNull()
  })

  it("parses the fenced JSON an analysis comes back in", async () => {
    const { run } = runner(
      "Here you go:\n```json\n" +
        JSON.stringify({
          summary: "A corridor walk.",
          shots: ["Wide on the door", "Push in on the handle"],
        }) +
        "\n```\n"
    )
    const outcome = await runHelper(
      { helper: "analyze-video", assetPath: "/p/b.mp4" },
      run
    )

    expect(outcome.summary).toBe("A corridor walk.")
    expect(outcome.shots).toEqual(["Wide on the door", "Push in on the handle"])
    expect(outcome.text).toContain("A corridor walk.")
  })

  it("flattens shot objects into their descriptions", async () => {
    const { run } = runner(
      JSON.stringify({
        summary: "s",
        shots: [{ description: "Wide", timestamp: "00:01" }, { text: "Close" }],
      })
    )
    const outcome = await runHelper(
      { helper: "analyze-video", assetPath: "/p/b.mp4" },
      run
    )

    expect(outcome.shots).toEqual(["Wide", "Close"])
  })

  it("falls back to the raw text when an analysis is not parseable", async () => {
    const { run } = runner("I could not read that file.")
    const outcome = await runHelper(
      { helper: "analyze-video", assetPath: "/p/b.mp4" },
      run
    )

    expect(outcome.text).toBe("I could not read that file.")
    expect(outcome.summary).toBeNull()
    expect(outcome.shots).toEqual([])
  })

  it("reads a suggested shot list out of a JSON array", async () => {
    const { run } = runner('```json\n["Establishing wide", "Reverse"]\n```')
    const outcome = await runHelper(
      { helper: "suggest-shots", containerName: "Lobby", notes: null },
      run
    )

    expect(outcome.shots).toEqual(["Establishing wide", "Reverse"])
  })

  it("reads a suggested shot list out of bullets or numbers", async () => {
    const { run } = runner(
      "1. Establishing wide\n- Reverse\n* Insert on the key\n"
    )
    const outcome = await runHelper(
      { helper: "suggest-shots", containerName: "Lobby", notes: null },
      run
    )

    expect(outcome.shots).toEqual([
      "Establishing wide",
      "Reverse",
      "Insert on the key",
    ])
  })

  it("refuses an empty answer rather than returning nothing", async () => {
    const { run } = runner("   \n  ")
    await expect(
      runHelper({ helper: "improve-prompt", prompt: "a cat" }, run)
    ).rejects.toThrow(/empty/i)
  })
})
