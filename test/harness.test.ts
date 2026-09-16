import { http, HttpResponse } from "msw"
import { expect, it } from "vitest"

import { server } from "./msw/server"

it("runs the test harness", () => {
  expect(1 + 1).toBe(2)
})

it("serves mocked requests through msw", async () => {
  server.use(
    http.get("https://api.example.test/ping", () =>
      HttpResponse.json({ ok: true })
    )
  )

  const res = await fetch("https://api.example.test/ping")

  expect(await res.json()).toEqual({ ok: true })
})

it("fails loudly on an unhandled (live) request", async () => {
  await expect(fetch("https://api.replicate.com/v1/models")).rejects.toThrow()
})
