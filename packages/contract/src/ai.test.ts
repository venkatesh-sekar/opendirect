import { describe, expect, it } from "vitest"

import {
  AI_IMAGE_HELPERS,
  AI_INSTRUCTIONS_MAX_LENGTH,
  AI_MODEL_PRESETS,
  aiModelSchema,
  aiRunRequestSchema,
  isImageHelper,
  isValidAiModel,
} from "./ai"

describe("aiModelSchema", () => {
  it("accepts aliases, full ids and qualified names", () => {
    for (const ok of [
      "opus",
      "sonnet",
      "claude-opus-5-5",
      "claude-opus-5-5[1m]",
      "us.anthropic.claude-opus-5-5",
      "gpt-5.5",
      "openai/gpt-5.5",
      "model@2026-01-01",
      "ollama:llama3",
    ]) {
      expect(isValidAiModel(ok)).toBe(true)
    }
  })

  it("trims surrounding whitespace", () => {
    expect(aiModelSchema.parse("  haiku\n")).toBe("haiku")
  })

  it("refuses anything that could become another flag or argument", () => {
    for (const bad of [
      "",
      " ",
      "-m",
      "--dangerously-skip-permissions",
      "opus --permission-mode bypassPermissions",
      "opus;id",
      "$(id)",
      "`id`",
      "a=b",
      'op"us',
      "x".repeat(101),
    ]) {
      expect(isValidAiModel(bad)).toBe(false)
    }
  })

  it("only ships presets that pass its own validation", () => {
    for (const presets of Object.values(AI_MODEL_PRESETS)) {
      expect(presets.length).toBeGreaterThan(0)
      for (const preset of presets)
        expect(isValidAiModel(preset.value)).toBe(true)
    }
  })
})

describe("aiRunRequestSchema", () => {
  const base = {
    runId: "r1",
    request: { helper: "improve-prompt", prompt: "a cat" },
  } as const

  it("keeps model and instructions optional, so older callers still parse", () => {
    const parsed = aiRunRequestSchema.parse(base)
    expect(parsed.model).toBeUndefined()
    expect(parsed.instructions).toBeUndefined()
  })

  it("distinguishes an explicit CLI default (null) from no choice", () => {
    expect(aiRunRequestSchema.parse({ ...base, model: null }).model).toBeNull()
    expect(aiRunRequestSchema.parse({ ...base, model: "opus" }).model).toBe(
      "opus"
    )
  })

  it("rejects an invalid model at the IPC boundary", () => {
    expect(
      aiRunRequestSchema.safeParse({ ...base, model: "--model=evil" }).success
    ).toBe(false)
  })

  it("bounds the direction's length", () => {
    expect(
      aiRunRequestSchema.safeParse({
        ...base,
        instructions: "x".repeat(AI_INSTRUCTIONS_MAX_LENGTH),
      }).success
    ).toBe(true)
    expect(
      aiRunRequestSchema.safeParse({
        ...base,
        instructions: "x".repeat(AI_INSTRUCTIONS_MAX_LENGTH + 1),
      }).success
    ).toBe(false)
  })
})

describe("image helpers", () => {
  it("parse an image request by asset id, never by path", () => {
    for (const helper of AI_IMAGE_HELPERS) {
      const parsed = aiRunRequestSchema.parse({
        runId: "r1",
        request: { helper, assetId: "a1" },
      })
      expect(parsed.request).toEqual({ helper, assetId: "a1" })
      expect(isImageHelper(helper)).toBe(true)
    }
    expect(
      aiRunRequestSchema.safeParse({
        runId: "r1",
        request: { helper: "explain-image", path: "/etc/passwd" },
      }).success
    ).toBe(false)
  })

  it("does not count the text helpers as image helpers", () => {
    expect(isImageHelper("improve-prompt")).toBe(false)
    expect(isImageHelper("describe-reference")).toBe(false)
  })
})
