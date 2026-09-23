import { afterEach, describe, expect, it } from "vitest"

import {
  canvasHref,
  containerHref,
  forgetReturnRoute,
  isOnRoute,
  rememberRoute,
  returnRoute,
} from "./routes"

afterEach(() => forgetReturnRoute())

describe("route helpers", () => {
  it("builds query-string links, because the static export has no [id] segments", () => {
    expect(containerHref("a b")).toBe("/container/?id=a%20b")
    expect(canvasHref()).toBe("/canvas/")
    expect(canvasHref("mira")).toBe("/canvas/?focus=mira")
  })

  it("matches a route with or without the export's trailing slash", () => {
    expect(isOnRoute("/", "/")).toBe(true)
    expect(isOnRoute("/canvas", "/")).toBe(false)
    expect(isOnRoute("/canvas", "/canvas/")).toBe(true)
    expect(isOnRoute("/canvas/", "/canvas/")).toBe(true)
    expect(isOnRoute("/characters/", "/canvas/")).toBe(false)
    expect(isOnRoute(null, "/")).toBe(true)
  })
})

describe("the route Settings returns to", () => {
  it("is Home until somewhere else has been visited", () => {
    expect(returnRoute()).toBe("/")
  })

  it("is the last route that was not Settings, query string and all", () => {
    rememberRoute("/canvas/", "?focus=mira")
    rememberRoute("/settings/", "?tab=general")
    expect(returnRoute()).toBe("/canvas/?focus=mira")
  })
})
