/**
 * How each canonical control reads in the mapping editor (design §3): its
 * name and one line on what it sets, so choosing "Maps to → Controls" is as
 * plain as choosing a role. Typed exhaustively over `ControlName`, so a new
 * control fails the build here until it has words.
 */
import type { ControlName } from "@opendirect/contract"

export interface ControlMeta {
  label: string
  description: string
  /**
   * Whether a value map is offered even when the field has no enum. Never
   * for `count`, which is always a number.
   */
  vocabulary: boolean
}

export const CONTROL_META: Record<ControlName, ControlMeta> = {
  prompt: {
    label: "Prompt",
    description: "The text prompt from the bar.",
    vocabulary: false,
  },
  negative_prompt: {
    label: "Negative prompt",
    description: "What the output should avoid.",
    vocabulary: false,
  },
  aspect_ratio: {
    label: "Aspect ratio",
    description: "The frame shape, such as 16:9.",
    vocabulary: true,
  },
  duration: {
    label: "Duration",
    description: "How long the output runs, in seconds.",
    vocabulary: true,
  },
  resolution: {
    label: "Resolution",
    description: "The output size, such as 720p.",
    vocabulary: true,
  },
  seed: {
    label: "Seed",
    description: "Makes a run repeatable.",
    vocabulary: false,
  },
  generate_audio: {
    label: "Generate audio",
    description: "Whether the output has sound.",
    vocabulary: false,
  },
  count: {
    label: "Count",
    description: "How many outputs one run makes; always a number.",
    vocabulary: false,
  },
}
