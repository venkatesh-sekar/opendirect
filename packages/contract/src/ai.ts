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

/**
 * A model name handed to a CLI's own `--model` flag.
 *
 * It travels as one argv element (never through a shell), but it is still
 * validated: a value starting with `-` would be read as another flag, and
 * nothing legitimate needs whitespace, quotes or `=`. The character set covers
 * every spelling both CLIs accept — aliases (`opus`), full ids
 * (`claude-opus-5-5`, `gpt-5.5`), suffixes like `[1m]`, and qualified names
 * (`us.anthropic.…`, `openai/…`, `name@version`).
 */
export const AI_MODEL_MAX_LENGTH = 100
const AI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/

export const aiModelSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter a model name." })
  .max(AI_MODEL_MAX_LENGTH, {
    message: `A model name is at most ${AI_MODEL_MAX_LENGTH} characters.`,
  })
  .regex(AI_MODEL_PATTERN, {
    message:
      "Use letters, digits and . _ - : / @ [ ] only, starting with a letter or digit.",
  })

/** True when `value` is a model name a CLI may be given (after trimming). */
export function isValidAiModel(value: string): boolean {
  return aiModelSchema.safeParse(value).success
}

/**
 * The model each CLI is started with. Null means "pass no `--model` flag", so
 * the CLI uses whatever its own config or account defaults to.
 */
export const aiToolModelsSchema = z.object({
  claude: aiModelSchema.nullable(),
  codex: aiModelSchema.nullable(),
})
export type AiToolModels = z.output<typeof aiToolModelsSchema>

export const aiToolModelsDefaults: AiToolModels = { claude: null, codex: null }

export interface AiModelPreset {
  value: string
  label: string
}

/**
 * Suggestions for the model picker. Any other name can be typed as a custom
 * model; these are only the common ones.
 *
 * - claude: the aliases `claude --help` documents for `--model`, each of which
 *   tracks the latest model of its tier (Claude Code 2.1.288).
 * - codex: listed names from codex's own catalog (`codex debug models`,
 *   codex-cli 0.155), passed to `codex exec --model`.
 */
export const AI_MODEL_PRESETS: Record<AiToolId, readonly AiModelPreset[]> = {
  claude: [
    { value: "fable", label: "Fable" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: "gpt-6-sol", label: "GPT-6 Sol" },
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
    { value: "gpt-5.5", label: "GPT-5.5" },
  ],
}

/** How long the free-form direction added to a helper run may be. */
export const AI_INSTRUCTIONS_MAX_LENGTH = 2000

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
  /**
   * The model for this run. Omitted means "the `aiModels` setting for the
   * chosen tool"; null means "the CLI's own default" (no `--model` flag).
   */
  model: aiModelSchema.nullable().optional(),
  /**
   * The user's own direction for this run ("more cinematic, keep the
   * outfit"), added to the helper's built-in task prompt. Never logged.
   */
  instructions: z
    .string()
    .max(AI_INSTRUCTIONS_MAX_LENGTH, {
      message: `Keep the direction under ${AI_INSTRUCTIONS_MAX_LENGTH} characters.`,
    })
    .nullable()
    .optional(),
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
