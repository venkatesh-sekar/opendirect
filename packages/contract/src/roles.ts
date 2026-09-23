/**
 * The reference-role list, in its own module because both `model.ts` and
 * `registry/schema.ts` need it and `model.ts` imports the registry schema —
 * keeping it here is what stops that dependency from becoming a cycle.
 * `model.ts` re-exports it, so existing imports keep working.
 */
import { z } from "zod"

/**
 * What an input controls in the output. ONE closed list. Rules (design §2,
 * docs/plans/2026-09-24-model-registry-design.md, and CONTRIBUTING.md):
 *  1. A role never encodes the media kind (`soundtrack`, not `audio`).
 *  2. Detail goes in the slot label, never a new role (no `face`).
 *  3. A new role must pass all three tests — controls something no other
 *     role does; ≥2 models from different vendors have it; the UX would
 *     filter or route it differently — otherwise it is `reference`.
 *  4. When unsure, `reference`.
 *  5. Changing this list is a contract change: bump REGISTRY_FORMAT and
 *     cite these rules in the PR.
 */
export const referenceRoleSchema = z.enum([
  "source",
  "mask",
  "first_frame",
  "last_frame",
  "character",
  "style",
  "structure",
  "motion",
  "soundtrack",
  "reference",
])
export type ReferenceRole = z.output<typeof referenceRoleSchema>
export const REFERENCE_ROLES = referenceRoleSchema.options
