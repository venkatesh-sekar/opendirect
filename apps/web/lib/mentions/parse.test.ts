import { describe, expect, it } from "vitest"

import { activeMentionQuery, findMentions, insertMention } from "./parse"

describe("findMentions", () => {
  it("finds a mention at the start of the prompt", () => {
    expect(findMentions("@venkz in a lift")).toEqual([
      { handle: "venkz", start: 0, end: 6 },
    ])
  })

  it("finds one mid-sentence and keeps the text around it", () => {
    const text = "a wide shot of @venkz, smiling"
    const [token] = findMentions(text)
    expect(token).toEqual({ handle: "venkz", start: 15, end: 21 })
    expect(text.slice(token!.start, token!.end)).toBe("@venkz")
  })

  it("finds several, in order of appearance, duplicates and all", () => {
    expect(
      findMentions("@venkz meets @lobby, then @venkz leaves").map(
        (t) => t.handle
      )
    ).toEqual(["venkz", "lobby", "venkz"])
  })

  it("accepts hyphens and digits, and stops before trailing punctuation", () => {
    expect(findMentions("(@hotel-lobby-2)").map((t) => t.handle)).toEqual([
      "hotel-lobby-2",
    ])
    expect(findMentions("@venkz.").map((t) => t.handle)).toEqual(["venkz"])
    expect(findMentions("@venkz-").map((t) => t.handle)).toEqual(["venkz"])
  })

  it("ignores an email address", () => {
    // ⛔ A handle only starts at a word boundary: nobody mentioning a
    // character types their address, and substituting inside one would send a
    // mangled prompt to a paid model.
    expect(findMentions("write to venkz@example.com")).toEqual([])
    expect(findMentions("a.b@venkz")).toEqual([])
  })

  it("ignores a bare @ and an uppercase handle", () => {
    expect(findMentions("@ venkz")).toEqual([])
    expect(findMentions("email @ me")).toEqual([])
    // Handles are lowercase by construction, so `@Venkz` is not one.
    expect(findMentions("@Venkz")).toEqual([])
  })

  it("finds one after a newline", () => {
    expect(findMentions("line one\n@venkz").map((t) => t.handle)).toEqual([
      "venkz",
    ])
  })
})

describe("activeMentionQuery", () => {
  it("reports the empty query the moment @ is typed", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0, end: 1 })
  })

  it("grows with what has been typed since", () => {
    expect(activeMentionQuery("a shot of @ve", 13)).toEqual({
      query: "ve",
      start: 10,
      end: 13,
    })
  })

  it("is null when the caret is before the @", () => {
    expect(activeMentionQuery("@venkz", 0)).toBeNull()
  })

  it("stops at whitespace — a finished mention is not being typed", () => {
    expect(activeMentionQuery("@venkz and", 10)).toBeNull()
    expect(activeMentionQuery("@venkz ", 7)).toBeNull()
  })

  it("is null inside an email address", () => {
    expect(activeMentionQuery("venkz@example", 13)).toBeNull()
  })

  it("follows the caret back into an existing mention", () => {
    // The caret sits between `@ven` and `kz`; that is still a query.
    expect(activeMentionQuery("@venkz", 4)).toEqual({
      query: "ven",
      start: 0,
      end: 4,
    })
  })

  it("takes the mention nearest the caret", () => {
    expect(activeMentionQuery("@venkz meets @lo", 16)).toEqual({
      query: "lo",
      start: 13,
      end: 16,
    })
  })

  it("keeps what the user typed, capitals and all", () => {
    expect(activeMentionQuery("@Ve", 3)?.query).toBe("Ve")
  })
})

describe("insertMention", () => {
  it("replaces the query with the handle and a trailing space", () => {
    expect(
      insertMention("a shot of @ve", { start: 10, end: 13 }, "venkz")
    ).toEqual({ text: "a shot of @venkz ", caret: 17 })
  })

  it("leaves the text after the range alone", () => {
    expect(
      insertMention("@ve, smiling", { start: 0, end: 3 }, "venkz")
    ).toEqual({ text: "@venkz , smiling", caret: 7 })
  })

  it("does not double the space that is already there", () => {
    expect(insertMention("@ve there", { start: 0, end: 3 }, "venkz")).toEqual({
      text: "@venkz there",
      caret: 7,
    })
  })
})
