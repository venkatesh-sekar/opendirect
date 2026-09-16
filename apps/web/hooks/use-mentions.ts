"use client"

import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { MentionSubjectDto } from "@opendirect/contract"

import { invoke } from "@/lib/ipc"
import { queryKeys } from "./query-keys"

/**
 * Every `@`-able character and scene in the open project.
 *
 * The `@` picker and `resolveMentions` read the same list, which is why it is
 * one query rather than a lookup per mention: the prompt bar recomputes the
 * plan on every keystroke and must not touch IPC to do it.
 *
 * Invalidated by the container and asset mutations that already invalidate the
 * tree — a rename changes a handle, and an import can give a character its
 * first reference image.
 */
export function useMentionSubjects(
  enabled = true
): UseQueryResult<MentionSubjectDto[]> {
  return useQuery({
    queryKey: queryKeys.mentions.subjects,
    queryFn: () => invoke("mentions:subjects"),
    enabled,
  })
}
