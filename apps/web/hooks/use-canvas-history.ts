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
  state: CanvasHistoryState
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
  }
}

export interface CanvasHistory {
  push: (entry: CanvasHistoryEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
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
 * only record of how to put the canvas back.
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
    ) => {
      if (running.current) return
      const step = take(latest.current)
      if (!step) return
      running.current = true
      setBusy(true)
      try {
        await run(step.entry)
        latest.current = step.state
        setState(step.state)
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
