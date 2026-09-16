// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { hasOpenModal } from "./modal"

function docWith(html: string): Document {
  const parsed = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html"
  )
  return parsed
}

describe("hasOpenModal", () => {
  it("is false for an ordinary window", () => {
    expect(
      hasOpenModal(docWith("<main><button>Generate</button></main>"))
    ).toBe(false)
  })

  it("is true while a dialog or an alert dialog is mounted", () => {
    expect(hasOpenModal(docWith('<div role="dialog">Advanced</div>'))).toBe(
      true
    )
    expect(hasOpenModal(docWith('<div role="alertdialog">Sure?</div>'))).toBe(
      true
    )
  })

  it("believes an explicit closed state over mere presence", () => {
    expect(
      hasOpenModal(docWith('<div role="dialog" data-state="closed"></div>'))
    ).toBe(false)
  })

  it("is false rather than throwing when there is no document", () => {
    expect(hasOpenModal(null)).toBe(false)
  })
})
