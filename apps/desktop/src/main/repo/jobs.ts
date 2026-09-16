/**
 * The `jobs` table: the runner's durable memory.
 *
 * A job row exists so the queue can be rebuilt from SQLite after a crash — the
 * in-memory `p-queue` is an optimisation, the rows are the truth. Every state
 * change the runner makes goes through here first and is pushed to the
 * renderer afterwards, so what the job list shows is always what was written.
 *
 * ⛔ Plain database writes. Nothing here calls a provider.
 */
import { randomUUID } from "node:crypto"

import {
  ACTIVE_JOB_STATES,
  type JobDto,
  type JobState,
} from "@opendirect/contract"
import { desc, eq, inArray } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import { generations, jobs, type Generation, type Job } from "../db/schema"
import { toGenerationDto } from "./generations"

const ACTIVE = new Set<string>(ACTIVE_JOB_STATES)

export function isActiveState(state: string): boolean {
  return ACTIVE.has(state)
}

/** `state` is a plain text column in SQLite; the contract narrows it. */
export function toJobDto(
  job: Job,
  generation: Generation,
  progress: number | null = null
): JobDto {
  return {
    id: job.id,
    generationId: job.generationId,
    state: job.state as JobState,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt,
    lastPolledAt: job.lastPolledAt,
    nextPollAt: job.nextPollAt,
    progress,
    generation: toGenerationDto(generation),
  }
}

export function getJob(db: ProjectDatabase, id: string): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}

export function requireJob(db: ProjectDatabase, id: string): Job {
  const job = getJob(db, id)
  if (!job) throw new Error(`Job ${id} was not found`)
  return job
}

/** The job for a run, if one was ever created. One job per generation. */
export function getJobForGeneration(
  db: ProjectDatabase,
  generationId: string
): Job | undefined {
  return db.select().from(jobs).where(eq(jobs.generationId, generationId)).get()
}

export interface CreateJobInput {
  generationId: string
  state?: JobState
  id?: string
  now?: number
}

export function createJob(db: ProjectDatabase, input: CreateJobInput): Job {
  const row: Job = {
    id: input.id ?? randomUUID(),
    generationId: input.generationId,
    state: input.state ?? "queued",
    attempts: 0,
    lastPolledAt: null,
    nextPollAt: null,
    error: null,
    createdAt: input.now ?? Date.now(),
  }
  db.insert(jobs).values(row).run()
  return row
}

export interface UpdateJobInput {
  state?: JobState
  attempts?: number
  error?: string | null
  lastPolledAt?: number | null
  nextPollAt?: number | null
}

export function updateJob(
  db: ProjectDatabase,
  id: string,
  patch: UpdateJobInput
): Job {
  const current = requireJob(db, id)
  const next: Job = {
    ...current,
    state: patch.state ?? current.state,
    attempts: patch.attempts ?? current.attempts,
    error: patch.error === undefined ? current.error : patch.error,
    lastPolledAt:
      patch.lastPolledAt === undefined
        ? current.lastPolledAt
        : patch.lastPolledAt,
    nextPollAt:
      patch.nextPollAt === undefined ? current.nextPollAt : patch.nextPollAt,
  }
  db.update(jobs)
    .set({
      state: next.state,
      attempts: next.attempts,
      error: next.error,
      lastPolledAt: next.lastPolledAt,
      nextPollAt: next.nextPollAt,
    })
    .where(eq(jobs.id, id))
    .run()
  return next
}

/** Jobs the runner still owes an answer for — what crash recovery re-enqueues. */
export function listActiveJobs(db: ProjectDatabase): Job[] {
  return db
    .select()
    .from(jobs)
    .where(inArray(jobs.state, [...ACTIVE_JOB_STATES]))
    .orderBy(desc(jobs.createdAt))
    .all()
}

export const DEFAULT_JOB_LIMIT = 50

/**
 * The job list, newest first, with each job's run joined in. Active jobs sort
 * ahead of finished ones: the queue is what the user opened the sheet for, and
 * yesterday's successes must never push today's running job off the top.
 */
export function listJobs(
  db: ProjectDatabase,
  options: { limit?: number } = {}
): JobDto[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_JOB_LIMIT)
  return db
    .select({ job: jobs, generation: generations })
    .from(jobs)
    .innerJoin(generations, eq(generations.id, jobs.generationId))
    .orderBy(desc(jobs.createdAt))
    .all()
    .sort((a, b) => {
      const activeDelta =
        Number(isActiveState(b.job.state)) - Number(isActiveState(a.job.state))
      return activeDelta !== 0 ? activeDelta : b.job.createdAt - a.job.createdAt
    })
    .slice(0, limit)
    .map((row) => toJobDto(row.job, row.generation))
}
