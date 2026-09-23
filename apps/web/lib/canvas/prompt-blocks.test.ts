/**
 * ⛔ Nothing in this file submits anything. These are the pure rules for
 * where each note sits in a prompt and what string the run will carry.
 */
import type { PromptBlock } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import type { MentionOutcome } from "@/lib/mentions/resolve"

import {
  appendText,
  mapRangesThroughMentions,
  mergeIntoPrevious,
  moveBlock,
  newTextBlock,
  reconcileBlocks,
  renderPromptBlocks,
  replaceText,
  textOfBlocks,
  type DraftBlock,
} from "./prompt-blocks"

function notes(entries: Record<string, string>) {
  return new Map(Object.entries(entries).map(([id, text]) => [id, { text }]))
}

const text = (value: string): PromptBlock => ({ kind: "text", text: value })
const note = (nodeId: string): PromptBlock => ({ kind: "note", nodeId })
const withoutId = (block: DraftBlock): PromptBlock =>
  block.kind === "note" ? note(block.nodeId) : text(block.text)

/** The old `composePrompt`, kept here to prove legacy recipes still match. */
function legacyCompose(prefix: string, prompt: string) {
  const p = prefix.trim(),
    b = prompt.trim()
  return p === "" ? b : b === "" ? p : `${p}\n\n${b}`
}

describe("renderPromptBlocks", () => {
  it("joins trimmed blocks with a blank line, notes and text in list order", () => {
    const rendered = renderPromptBlocks(
      [text("  a forest "), note("n1"), text("at dusk")],
      notes({ n1: " golden hour\n" })
    )
    expect(rendered.prompt).toBe("a forest\n\ngolden hour\n\nat dusk")
  })

  it("drops blank text, blank notes and notes it cannot find", () => {
    const rendered = renderPromptBlocks(
      [text("   "), note("blank"), note("gone"), text("a forest"), text("")],
      notes({ blank: " \n " })
    )
    expect(rendered.prompt).toBe("a forest")
  })

  it("reports a range per contributing block that slices back to its text", () => {
    const blocks = [text("  a forest "), text(""), note("n1"), text("dusk")]
    const rendered = renderPromptBlocks(blocks, notes({ n1: " golden hour " }))
    expect(rendered.ranges.map((range) => range.blockIndex)).toEqual([0, 2, 3])
    expect(
      rendered.ranges.map((range) =>
        rendered.prompt.slice(range.start, range.end)
      )
    ).toEqual(["a forest", "golden hour", "dusk"])
  })

  it("renders an empty list as an empty prompt", () => {
    expect(renderPromptBlocks([], new Map())).toEqual({
      prompt: "",
      ranges: [],
    })
  })
})

describe("reconcileBlocks", () => {
  it("builds notes in wire order then the prompt for a legacy recipe", () => {
    expect(
      reconcileBlocks({
        blocks: undefined,
        prompt: "  a forest ",
        noteIds: ["b", "a"],
      })
    ).toEqual([
      { id: "note:b", kind: "note", nodeId: "b" },
      { id: "note:a", kind: "note", nodeId: "a" },
      { id: "text:2", kind: "text", text: "  a forest " },
    ])
  })

  it("makes a new, empty legacy prompt one empty text block", () => {
    expect(
      reconcileBlocks({ blocks: undefined, prompt: "", noteIds: [] })
    ).toEqual([{ id: "text:0", kind: "text", text: "" }])
  })

  it("inserts a newly wired note after the leading run of notes", () => {
    const withLeading = reconcileBlocks({
      blocks: [note("a"), text("x"), note("b")],
      prompt: "",
      noteIds: ["a", "b", "c"],
    })
    expect(withLeading.map(withoutId)).toEqual([
      note("a"),
      note("c"),
      text("x"),
      note("b"),
      text(""),
    ])
    const withoutLeading = reconcileBlocks({
      blocks: [text("x")],
      prompt: "",
      noteIds: ["c"],
    })
    expect(withoutLeading.map(withoutId)).toEqual([note("c"), text("x")])
  })

  it("drops a block for a note that is no longer wired in", () => {
    const blocks = reconcileBlocks({
      blocks: [note("gone"), text("x")],
      prompt: "",
      noteIds: [],
    })
    expect(blocks.map(withoutId)).toEqual([text("x")])
  })

  it("drops the second block for the same note", () => {
    const blocks = reconcileBlocks({
      blocks: [note("a"), text("x"), note("a"), text("y")],
      prompt: "",
      noteIds: ["a"],
    })
    expect(blocks.map(withoutId)).toEqual([note("a"), text("x"), text("y")])
  })

  it("always ends with a text block", () => {
    const endsWithNote = reconcileBlocks({
      blocks: [text("x"), note("a")],
      prompt: "",
      noteIds: ["a"],
    })
    expect(endsWithNote.at(-1)).toEqual({
      id: "text:2",
      kind: "text",
      text: "",
    })
    const endsWithText = reconcileBlocks({
      blocks: [note("a"), text("x")],
      prompt: "",
      noteIds: ["a"],
    })
    expect(endsWithText).toHaveLength(2)
  })

  it("keeps existing ids and returns the same array when nothing changed", () => {
    const blocks: DraftBlock[] = [
      { id: "n", kind: "note", nodeId: "a" },
      { id: "t-9", kind: "text", text: "x" },
    ]
    expect(reconcileBlocks({ blocks, prompt: "", noteIds: ["a"] })).toBe(blocks)
    const next = reconcileBlocks({
      blocks: [...blocks, { id: "n2", kind: "note", nodeId: "b" }],
      prompt: "",
      noteIds: ["a", "b"],
    })
    expect(next.map((block) => block.id)).toEqual(["n", "t-9", "n2", "text:3"])
  })
})

describe("legacy parity", () => {
  const fixtures: { name: string; prompt: string; notes: string[] }[] = [
    { name: "no notes", prompt: "  a forest  ", notes: [] },
    { name: "notes only", prompt: "", notes: ["golden hour", "wide shot"] },
    {
      name: "padded and blank notes",
      prompt: "a forest",
      notes: ["  golden hour \n", "   ", "\twide shot"],
    },
    {
      name: "notes and a padded prompt",
      prompt: "   a forest at dusk \n",
      notes: ["golden hour", "wide shot "],
    },
  ]

  for (const fixture of fixtures) {
    it(`sends what composePrompt sent: ${fixture.name}`, () => {
      const noteIds = fixture.notes.map((_text, index) => `n${index}`)
      const notesById = new Map(
        fixture.notes.map((value, index) => [`n${index}`, { text: value }])
      )
      const prefix = fixture.notes
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n\n")
      const blocks = reconcileBlocks({
        blocks: undefined,
        prompt: fixture.prompt,
        noteIds,
      })
      expect(renderPromptBlocks(blocks, notesById).prompt).toBe(
        legacyCompose(prefix, fixture.prompt)
      )
    })
  }
})

describe("block edits", () => {
  const draft: DraftBlock[] = [
    { id: "n1", kind: "note", nodeId: "a" },
    { id: "t1", kind: "text", text: " a forest " },
    { id: "n2", kind: "note", nodeId: "b" },
    { id: "t2", kind: "text", text: "" },
  ]

  it("textOfBlocks joins the trimmed, non-empty text blocks only", () => {
    expect(
      textOfBlocks([...draft, { id: "t3", kind: "text", text: " at dusk" }])
    ).toBe("a forest\n\nat dusk")
  })

  it("moveBlock moves a block to the other block's index", () => {
    expect(moveBlock(draft, "n2", "n1").map((block) => block.id)).toEqual([
      "n2",
      "n1",
      "t1",
      "t2",
    ])
    expect(moveBlock(draft, "n1", "n2").map((block) => block.id)).toEqual([
      "t1",
      "n2",
      "n1",
      "t2",
    ])
    expect(moveBlock(draft, "missing", "n1")).toBe(draft)
  })

  it("replaceText keeps the notes in order and puts the text after them", () => {
    const next = replaceText(draft, "a new prompt")
    expect(next.map(withoutId)).toEqual([
      note("a"),
      note("b"),
      text("a new prompt"),
    ])
  })

  it("appendText fills an empty last text block or appends after a comma", () => {
    const filled = appendText(draft, "wide shot")
    expect(filled.at(-1)).toMatchObject({ id: "t2", text: "wide shot" })
    const appended = appendText(filled.slice(0, 2), "close up")
    expect(appended.at(-1)).toMatchObject({
      id: "t1",
      text: " a forest, close up",
    })
  })

  it("mergeIntoPrevious removes an empty text block and focuses the previous text", () => {
    expect(mergeIntoPrevious(draft, "t2")).toEqual({
      blocks: draft.slice(0, 3),
      focus: "t1",
    })
  })

  it("mergeIntoPrevious leaves non-empty blocks and first text blocks alone", () => {
    expect(mergeIntoPrevious(draft, "t1")).toEqual({
      blocks: draft,
      focus: null,
    })
    const first: DraftBlock[] = [
      { id: "n1", kind: "note", nodeId: "a" },
      { id: "t1", kind: "text", text: "" },
    ]
    expect(mergeIntoPrevious(first, "t1")).toEqual({
      blocks: first,
      focus: null,
    })
  })

  it("newTextBlock gives every block its own id", () => {
    const a = newTextBlock()
    const b = newTextBlock("x")
    expect(a).toMatchObject({ kind: "text", text: "" })
    expect(b).toMatchObject({ kind: "text", text: "x" })
    expect(a.id).toMatch(/^t-\d+$/)
    expect(a.id).not.toBe(b.id)
  })
})

describe("mapRangesThroughMentions", () => {
  const raw = "note\n\n@venkz here"
  const ranges = [
    { blockIndex: 0, start: 0, end: 4 },
    { blockIndex: 1, start: 6, end: 17 },
  ]

  it("leaves ranges alone when there are no mentions", () => {
    expect(mapRangesThroughMentions("note\n\nhere", ranges, [])).toEqual(ranges)
  })

  it("stretches a block's range by what its mention became", () => {
    const substitution = "Venkz (the person in the reference image)"
    const outcomes: MentionOutcome[] = [
      {
        kind: "image",
        handle: "venkz",
        containerId: "c1",
        slotField: "image",
        assetIds: ["a1"],
        thumbnailUrls: [null],
        substitution,
      },
    ]
    const resolved = `note\n\n${substitution} here`
    const mapped = mapRangesThroughMentions(raw, ranges, outcomes)
    expect(mapped[0]).toEqual(ranges[0])
    expect(mapped[1]).toEqual({
      blockIndex: 1,
      start: 6,
      end: 17 + substitution.length - "@venkz".length,
    })
    expect(
      mapped.map((range) => resolved.slice(range.start, range.end))
    ).toEqual(["note", `${substitution} here`])
  })

  it("does not move offsets for a handle nobody claims", () => {
    expect(
      mapRangesThroughMentions(raw, ranges, [
        { kind: "unresolved", handle: "venkz" },
      ])
    ).toEqual(ranges)
  })
})
