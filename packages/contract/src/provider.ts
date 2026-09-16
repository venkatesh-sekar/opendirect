/**
 * Provider identity.
 *
 * It lives in its own module because both `ipc.ts` and `model.ts` need it and
 * `ipc.ts` already imports `model.ts` — keeping it here is what stops that
 * dependency from becoming a cycle.
 */
import { z } from "zod"

/** The two model providers OpenDirect talks to. */
export const providerIdSchema = z.enum(["replicate", "openrouter"])
export type ProviderId = z.output<typeof providerIdSchema>
