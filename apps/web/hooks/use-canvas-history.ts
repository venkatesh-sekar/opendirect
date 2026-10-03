"use client"

/**
 * Undo and redo, for the canvas and for nothing else.
 *
 * ⛔ **A generation is never on this stack.** Undo covers node add, move and
 * delete, edge add and delete, and pick change. It does not undo a run,
 * because a run has already been paid for and there is nothing to take back —
 * and it does not redo one either, because a redo that re-submitted would
 * spend money on a keystroke. The operation kinds are a closed set
 * (`CANVAS_OPERATIONS`), so a caller cannot put a run on the stack by
 * accident, and `pushEntry` throws rather than silently accepting one.
 *
 * An entry is an **inverse pair**: two thunks the caller builds from the
 * mutations in `use-canvas.ts`. Deleting a node records a `redo` that deletes
 * it again and an `undo` that re-creates it — both of which go through the
 * same IPC channels the original action did, so undo is not a second way to
 * write to the database. Keeping them as thunks is what lets an undo that has
 * to re-create a node *and* its edges stay one entry.
 *
 * The stack is bounded. A canvas session is long and every drag is an entry;
 * an unbounded stack holds every closure it was ever given.
 *
 * An entry can outlive what it points at: an asset deleted from the Assets tab
 * takes its media nodes with it, and the step that would bring one back has
 * nothing left to bring back. Its thunk says so by throwing a
 * `StaleHistoryEntryError`, and the step is dropped rather than kept — it can
 * never succeed, and leaving it on top would wedge every step beneath it.
 */
import { useCallback, useMemo, useRef, useState } from "react"

/**
 * Everything undo is allowed to cover. Closed on purpose — see the ⛔ above.
 */
export const CANVAS_OPERATIONS = [
  "node:create",
  "node:move",
  "node:delete",
  "node:pick",
  "edge:create",
  "edge:delete",
] as const

export type CanvasOperation = (typeof CANVAS_OPERATIONS)[number]

const OPERATIONS: ReadonlySet<string> = new Set(CANVAS_OPERATIONS)

export function isCanvasOperation(value: string): value is CanvasOperation {
  return OPERATIONS.has(value)
}

export interface CanvasHistoryEntry {
  operation: CanvasOperation
  /** What the menu item reads: "Move 3 nodes", "Delete node". */
  label: string
  /** Puts the canvas back the way it was. */
  undo: () => void | Promise<void>
  /** Does it again, after an undo. */
  redo: () => void | Promise<void>
}

/**
 * Thrown by an entry's `undo` or `redo` when what it would restore no longer
 * exists — an asset deleted since, and the media node that went with it. The
 * message says why, in words the user can read.
 */
export class StaleHistoryEntryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StaleHistoryEntryError"
  }
}

/** How many entries are kept. Older ones fall off the bottom. */
export const HISTORY_LIMIT = 100

export interface CanvasHistoryState {
  past: readonly CanvasHistoryEntry[]
  future: readonly CanvasHistoryEntry[]
}

export function emptyHistory(): CanvasHistoryState {
  return { past: [], future: [] }
}

/**
 * Records an entry. A new action makes the redo branch unreachable, so the
 * future is dropped — the same rule every editor uses.
 */
export function pushEntry(
  state: CanvasHistoryState,
  entry: CanvasHistoryEntry,
  limit: number = HISTORY_LIMIT
): CanvasHistoryState {
  if (!isCanvasOperation(entry.operation)) {
    throw new Error(
      `"${entry.operation}" is not a canvas operation. Undo covers the canvas only — a generation is never on the stack.`
    )
  }
  const past = [...state.past, entry]
  return { past: past.slice(Math.max(0, past.length - limit)), future: [] }
}

export interface CanvasHistoryStep {
  entry: CanvasHistoryEntry
  /** The stacks once the entry has replayed. */
  state: CanvasHistoryState
  /** The stacks with the entry gone from both — what a stale entry leaves. */
  without: CanvasHistoryState
}

/** The entry an undo would replay, and the stack it leaves behind. */
export function undoEntry(state: CanvasHistoryState): CanvasHistoryStep | null {
  const entry = state.past[state.past.length - 1]
  if (!entry) return null
  return {
    entry,
    state: {
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
    },
    without: { past: state.past.slice(0, -1), future: state.future },
  }
}

/** The entry a redo would replay, and the stack it leaves behind. */
export function redoEntry(state: CanvasHistoryState): CanvasHistoryStep | null {
  const entry = state.future[0]
  if (!entry) return null
  return {
    entry,
    state: {
      past: [...state.past, entry],
      future: state.future.slice(1),
    },
    without: { past: state.past, future: state.future.slice(1) },
  }
}

/** What one press of Undo or Redo came to. */
export type CanvasReplayResult =
  /** Nothing to replay, or a replay was already in flight. */
  | { status: "idle" }
  | { status: "done"; entry: CanvasHistoryEntry }
  /** The entry could no longer apply and is gone from the stack. */
  | { status: "dropped"; entry: CanvasHistoryEntry; reason: string }

export interface CanvasHistory {
  push: (entry: CanvasHistoryEntry) => void
  undo: () => Promise<CanvasReplayResult>
  redo: () => Promise<CanvasReplayResult>
  clear: () => void
  canUndo: boolean
  canRedo: boolean
  /** What the Undo control says it would undo; null when there is nothing. */
  undoLabel: string | null
  redoLabel: string | null
  /** True while a replay is in flight. A second press is ignored, not queued. */
  busy: boolean
  depth: number
}

/**
 * The rail's undo and redo buttons, and the two keyboard shortcuts.
 *
 * A replay that throws leaves the stacks exactly as they were and rethrows,
 * so the failed step is still there to try again — moving it would lose the
 * only record of how to put the canvas back. The one exception is a
 * `StaleHistoryEntryError`: that step can never succeed, so it is dropped and
 * the press resolves `"dropped"` instead of throwing.
 */
export function useCanvasHistory(limit: number = HISTORY_LIMIT): CanvasHistory {
  const [state, setState] = useState<CanvasHistoryState>(emptyHistory)
  const [busy, setBusy] = useState(false)
  // The stacks are also read inside async callbacks, where a `state` closure
  // would be one render behind. Every write below keeps the two in step, and
  // nothing else touches either.
  const latest = useRef<CanvasHistoryState>(state)
  const running = useRef(false)

  const push = useCallback(
    (entry: CanvasHistoryEntry) => {
      // Checked here rather than in the updater so a caller that tries to put
      // a run on the stack hears about it at the call site.
      if (!isCanvasOperation(entry.operation)) {
        throw new Error(
          `"${entry.operation}" is not a canvas operation. Undo covers the canvas only — a generation is never on the stack.`
        )
      }
      setState((current) => {
        const next = pushEntry(current, entry, limit)
        latest.current = next
        return next
      })
    },
    [limit]
  )

  const replay = useCallback(
    async (
      take: (state: CanvasHistoryState) => CanvasHistoryStep | null,
      run: (entry: CanvasHistoryEntry) => void | Promise<void>
    ): Promise<CanvasReplayResult> => {
      if (running.current) return { status: "idle" }
      const step = take(latest.current)
      if (!step) return { status: "idle" }
      running.current = true
      setBusy(true)
      try {
        try {
          await run(step.entry)
        } catch (error) {
          if (!(error instanceof StaleHistoryEntryError)) throw error
          latest.current = step.without
          setState(step.without)
          return { status: "dropped", entry: step.entry, reason: error.message }
        }
        latest.current = step.state
        setState(step.state)
        return { status: "done", entry: step.entry }
      } finally {
        running.current = false
        setBusy(false)
      }
    },
    []
  )

  const undo = useCallback(
    () => replay(undoEntry, (entry) => entry.undo()),
    [replay]
  )
  const redo = useCallback(
    () => replay(redoEntry, (entry) => entry.redo()),
    [replay]
  )

  const clear = useCallback(() => {
    latest.current = emptyHistory()
    setState(latest.current)
  }, [])

  return useMemo(
    () => ({
      push,
      undo,
      redo,
      clear,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undoLabel: state.past[state.past.length - 1]?.label ?? null,
      redoLabel: state.future[0]?.label ?? null,
      busy,
      depth: state.past.length,
    }),
    [push, undo, redo, clear, state, busy]
  )
}
