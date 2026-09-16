/**
 * The four AI helpers: what each one asks for, and how its answer is read.
 *
 * They are deliberately few and deliberately explicit. OpenDirect does not
 * have an assistant that watches you work — it has four menu items you press,
 * each of which produces text you then choose to keep or throw away. Nothing
 * here applies anything: `runHelper` returns, and a dialog does the rest.
 *
 * Prompt building and answer parsing live together because they are one
 * contract: the prompt asks for JSON, so the parser looks for JSON — and when
 * the CLI ignores the instruction (they do), the raw text is still shown
 * rather than an error about a missing field.
 *
 * Paths reaching these prompts have already been through `realAssetPath` in
 * `ai-service.ts`; nothing here accepts a path from the renderer.
 *
 * ⛔ No provider call, no generation. Text in, text out.
 */
import type { AiHelperId } from "@opendirect/contract"

/** A helper request with its asset ids already resolved to real paths. */
export type ResolvedHelperRequest =
  | { helper: "improve-prompt"; prompt: string; modelName?: string | null }
  | { helper: "describe-reference"; assetPath: string }
  | { helper: "analyze-video"; assetPath: string }
  | { helper: "suggest-shots"; containerName: string; notes?: string | null }

export interface HelperOutcome {
  /** Always something to show; the dialog never renders an empty body. */
  text: string
  /** The one-line gist, when the helper produces one. */
  summary: string | null
  /** Individually insertable lines, when the helper produces a list. */
  shots: string[]
}

/** Runs one prompt through whichever CLI the caller chose. */
export type HelperRunner = (prompt: string) => Promise<string>

const NO_PREAMBLE =
  "Reply with only the answer itself — no preamble, no explanation, no markdown fence."

export function helperPrompt(request: ResolvedHelperRequest): string {
  switch (request.helper) {
    case "improve-prompt": {
      const target = request.modelName
        ? `the generative model "${request.modelName}"`
        : "a generative video or image model"
      return [
        `Rewrite this prompt for ${target}.`,
        "Keep the user's intent and subject exactly; make it concrete about",
        "shot, camera move, lighting, lens and mood. One paragraph, no lists.",
        NO_PREAMBLE,
        "",
        "Prompt:",
        request.prompt,
      ].join("\n")
    }

    case "describe-reference": {
      return [
        "Read this image or video file and describe what it shows, so it can",
        "be used as a reference for a generative model: subject, framing,",
        "lighting, colour, texture and mood. One paragraph.",
        NO_PREAMBLE,
        "",
        `File: ${request.assetPath}`,
      ].join("\n")
    }

    case "analyze-video": {
      return [
        "Watch this video file and break it down.",
        'Reply with only a JSON object: {"summary": string, "shots": string[]}',
        "where summary is one sentence and each shot is one line describing",
        "that beat — framing, camera move and action.",
        "",
        `File: ${request.assetPath}`,
      ].join("\n")
    }

    case "suggest-shots": {
      const lines = [
        `Suggest 6 to 10 shots for a sequence called "${request.containerName}".`,
        "Each shot is one line: framing, camera move, subject and action.",
        "Reply with only a JSON array of strings.",
      ]
      if (request.notes?.trim()) {
        lines.push("", `Notes: ${request.notes.trim()}`)
      }
      return lines.join("\n")
    }
  }
}

/** Drops a wrapping ``` fence and trims each line's trailing whitespace. */
export function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  const body = fenced?.[1] ?? trimmed
  return body
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim()
}

/** The first JSON object or array in a CLI answer, fenced or not. */
export function parseJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const start = candidate.search(/[[{]/)
    if (start === -1) continue
    const opener = candidate[start]
    const end = candidate.lastIndexOf(opener === "{" ? "}" : "]")
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      continue
    }
  }
  return null
}

/** A shot may come back as a string or as an object with a description. */
function toShot(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    for (const field of ["description", "text", "shot", "summary"]) {
      const found = record[field]
      if (typeof found === "string" && found.trim()) return found.trim()
    }
  }
  return null
}

function toShots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(toShot).filter((shot): shot is string => shot !== null)
}

/** `- foo`, `* foo` and `1. foo`, for a CLI that ignored the JSON request. */
function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map(
      (line) => /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)?.[1]?.trim() ?? ""
    )
    .filter((line) => line.length > 0)
}

export async function runHelper(
  request: ResolvedHelperRequest,
  run: HelperRunner
): Promise<HelperOutcome> {
  const raw = await run(helperPrompt(request))
  const text = stripFences(raw)
  if (!text) {
    throw new Error("The AI helper returned an empty answer.")
  }

  switch (request.helper) {
    case "improve-prompt":
    case "describe-reference":
      return { text, summary: null, shots: [] }

    case "analyze-video": {
      const parsed = parseJsonBlock(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        const summary =
          typeof record.summary === "string" ? record.summary.trim() : null
        const shots = toShots(record.shots)
        if (summary || shots.length > 0) {
          return {
            // A readable rendering of the same thing the fields carry, so the
            // dialog has one body to show whether or not parsing worked.
            text: [summary, ...shots.map((shot) => `• ${shot}`)]
              .filter(Boolean)
              .join("\n"),
            summary,
            shots,
          }
        }
      }
      // Unparseable is not a failure: show what the CLI actually said.
      return { text, summary: null, shots: [] }
    }

    case "suggest-shots": {
      const parsed = parseJsonBlock(raw)
      const shots =
        toShots(parsed).length > 0 ? toShots(parsed) : bulletLines(text)
      return {
        text:
          shots.length > 0 ? shots.map((shot) => `• ${shot}`).join("\n") : text,
        summary: null,
        shots,
      }
    }
  }
}

/** Which helper each menu item maps to — shared with the renderer's menu. */
export const HELPER_IDS: readonly AiHelperId[] = [
  "improve-prompt",
  "describe-reference",
  "analyze-video",
  "suggest-shots",
]
