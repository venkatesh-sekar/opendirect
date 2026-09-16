import { z } from "zod"

/**
 * The AI helpers, and the two locally installed CLIs that can serve them.
 *
 * OpenDirect never ships an AI provider of its own for these: it spawns the
 * `claude` or `codex` binary the user already has on their PATH, so the help
 * runs on their subscription, on their machine, and only when they ask for it.
 *
 * ⛔ Nothing in this file is a generation. The helpers write and read *text*;
 * no paid media call is ever made on their behalf.
 */

export const aiToolIdSchema = z.enum(["claude", "codex"])
export type AiToolId = z.output<typeof aiToolIdSchema>

/** What detection found for one CLI. `path`/`version` are null when absent. */
export const aiToolStatusSchema = z.object({
  id: aiToolIdSchema,
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
})
export type AiToolStatus = z.output<typeof aiToolStatusSchema>

export const aiToolsSchema = z.object({
  claude: aiToolStatusSchema,
  codex: aiToolStatusSchema,
  /**
   * Which one a helper uses when the user does not pick: the `preferredAiTool`
   * setting when that tool is installed, otherwise whichever is. Null when
   * neither is — the single flag every AI entry point in the UI is hidden by.
   */
  preferred: aiToolIdSchema.nullable(),
  /** When this detection ran, so Settings can say how stale it is. */
  detectedAt: z.number(),
})
export type AiTools = z.output<typeof aiToolsSchema>

export const aiHelperIdSchema = z.enum([
  "improve-prompt",
  "describe-reference",
  "analyze-video",
  "suggest-shots",
])
export type AiHelperId = z.output<typeof aiHelperIdSchema>

/** Labels shared by the menu and the result dialog, so the two cannot drift. */
export const AI_HELPER_LABELS: Record<AiHelperId, string> = {
  "improve-prompt": "Improve prompt",
  "describe-reference": "Describe reference",
  "analyze-video": "Analyze video",
  "suggest-shots": "Suggest shots",
}

/**
 * One helper request.
 *
 * `runId` is minted by the renderer so a run can be cancelled before its
 * `ai:run` promise settles, and so the progress events can be matched to the
 * dialog that is waiting for them.
 *
 * Reference-reading helpers name an **asset id**, never a path: main looks the
 * row up and re-checks it against the project root before the path is handed
 * to a child process (`realAssetPath`), exactly as `shell:openAsset` does.
 */
export const aiRunRequestSchema = z.object({
  runId: z.string().min(1),
  /** Null means "whatever `preferred` resolved to". */
  tool: aiToolIdSchema.nullable().optional(),
  request: z.discriminatedUnion("helper", [
    z.object({
      helper: z.literal("improve-prompt"),
      prompt: z.string().min(1),
      modelName: z.string().nullable().optional(),
    }),
    z.object({
      helper: z.literal("describe-reference"),
      assetId: z.string().min(1),
    }),
    z.object({
      helper: z.literal("analyze-video"),
      assetId: z.string().min(1),
    }),
    z.object({
      helper: z.literal("suggest-shots"),
      containerName: z.string().min(1),
      notes: z.string().nullable().optional(),
    }),
  ]),
})
export type AiRunRequest = z.output<typeof aiRunRequestSchema>

/**
 * A finished helper run.
 *
 * `text` is always the thing to show; `shots` and `summary` are the extra
 * structure the two list-shaped helpers can usually parse out and that the
 * dialog inserts one line at a time. Nothing here is applied automatically —
 * see `<HelperResultDialog/>`.
 */
export const aiResultSchema = z.object({
  runId: z.string(),
  helper: aiHelperIdSchema,
  tool: aiToolIdSchema,
  text: z.string(),
  summary: z.string().nullable(),
  shots: z.array(z.string()),
  durationMs: z.number(),
})
export type AiResult = z.output<typeof aiResultSchema>

/** Progress pushed while a helper runs, keyed by the request's `runId`. */
export const aiProgressSchema = z.object({
  runId: z.string(),
  helper: aiHelperIdSchema,
  tool: aiToolIdSchema,
  state: z.enum(["started", "output", "finished", "failed", "canceled"]),
  /**
   * The newest slice of the CLI's own output, for the dialog's live log. Never
   * the prompt, and never persisted.
   */
  chunk: z.string().nullable(),
  message: z.string().nullable(),
})
export type AiProgress = z.output<typeof aiProgressSchema>
