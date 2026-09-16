// @vitest-environment jsdom
/**
 * ⛔ The rule this file exists to hold: a generation is never on the undo
 * stack. Nothing here calls a provider, and no test path submits anything.
 */
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  CANVAS_OPERATIONS,
  emptyHistory,
  isCanvasOperation,
  pushEntry,
  redoEntry,
  undoEntry,
  useCanvasHistory,
  type CanvasHistoryEntry,
  type CanvasOperation,
} from "./use-canvas-history"

/**
 * An entry whose inverse pair records what it was asked to replay, standing
 * in for the mutations in `use-canvas.ts`.
 */
function entry(
  operation: CanvasOperation,
  log: string[],
  label: string = operation
): CanvasHistoryEntry {
  return {
    operation,
    label,
    undo: () => {
      log.push(`undo:${label}`)
    },
    redo: () => {
      log.push(`redo:${label}`)
    },
  }
}

describe("the closed set of canvas operations", () => {
  it("covers exactly what the design says undo covers", () => {
    expect([...CANVAS_OPERATIONS].sort()).toEqual([
      "edge:create",
      "edge:delete",
      "node:create",
      "node:delete",
      "node:move",
      "node:pick",
    ])
  })

  it("refuses anything to do with a generation", () => {
    for (const kind of [
      "generation:submit",
      "generation:retry",
      "generations:submitBatch",
      "job:cancel",
    ]) {
      expect(isCanvasOperation(kind)).toBe(false)
    }
  })
})

describe("pushEntry", () => {
  it("throws rather than putting a generation on the stack", () => {
    const log: string[] = []
    const paid = {
      ...entry("node:create", log),
      operation: "generation:submit" as unknown as CanvasOperation,
    }
    expect(() => pushEntry(emptyHistory(), paid)).toThrow(/never on the stack/)
  })

  it("drops the redo branch when a new action is recorded", () => {
    const log: string[] = []
    let state = pushEntry(emptyHistory(), entry("node:create", log, "a"))
    state = undoEntry(state)!.state
    expect(state.future).toHaveLength(1)
    state = pushEntry(state, entry("node:move", log, "b"))
    expect(state.future).toHaveLength(0)
    expect(state.past.map((one) => one.label)).toEqual(["b"])
  })

  it("is bounded, dropping the oldest entry first", () => {
    const log: string[] = []
    let state = emptyHistory()
    for (let index = 0; index < 5; index += 1) {
      state = pushEntry(state, entry("node:move", log, `m${index}`), 3)
    }
    expect(state.past.map((one) => one.label)).toEqual(["m2", "m3", "m4"])
  })
})

describe("undoEntry and redoEntry", () => {
  it("answer null on an empty stack", () => {
    expect(undoEntry(emptyHistory())).toBeNull()
    expect(redoEntry(emptyHistory())).toBeNull()
  })

  it("move the newest entry between past and future", () => {
    const log: string[] = []
    let state = pushEntry(emptyHistory(), entry("node:create", log, "a"))
    state = pushEntry(state, entry("node:delete", log, "b"))

    const undone = undoEntry(state)!
    expect(undone.entry.label).toBe("b")
    expect(undone.state.past.map((one) => one.label)).toEqual(["a"])
    expect(undone.state.future.map((one) => one.label)).toEqual(["b"])

    const redone = redoEntry(undone.state)!
    expect(redone.entry.label).toBe("b")
    expect(redone.state.past.map((one) => one.label)).toEqual(["a", "b"])
    expect(redone.state.future).toEqual([])
  })
})

describe("useCanvasHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const { result } = renderHook(() => useCanvasHistory())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.undoLabel).toBeNull()
    expect(result.current.redoLabel).toBeNull()
    expect(result.current.depth).toBe(0)
  })

  it("replays add, move, delete and pick in both directions", async () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory())

    for (const operation of [
      "node:create",
      "node:move",
      "node:delete",
      "node:pick",
    ] as const) {
      act(() => result.current.push(entry(operation, log)))
    }
    expect(result.current.depth).toBe(4)
    expect(result.current.undoLabel).toBe("node:pick")

    await act(async () => {
      await result.current.undo()
      await result.current.undo()
    })
    expect(log).toEqual(["undo:node:pick", "undo:node:delete"])
    expect(result.current.canRedo).toBe(true)
    expect(result.current.redoLabel).toBe("node:delete")

    await act(async () => {
      await result.current.redo()
    })
    expect(log).toEqual([
      "undo:node:pick",
      "undo:node:delete",
      "redo:node:delete",
    ])
    expect(result.current.undoLabel).toBe("node:delete")
  })

  it("replays an edge add and an edge delete", async () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory())
    act(() => result.current.push(entry("edge:create", log)))
    act(() => result.current.push(entry("edge:delete", log)))

    await act(async () => {
      await result.current.undo()
      await result.current.undo()
    })
    expect(log).toEqual(["undo:edge:delete", "undo:edge:create"])
    expect(result.current.canUndo).toBe(false)
  })

  it("undoes nothing when there is nothing to undo", async () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory())
    await act(async () => {
      await result.current.undo()
      await result.current.redo()
    })
    expect(log).toEqual([])
  })

  it("throws when a caller tries to put a generation on the stack", () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory())
    expect(() =>
      result.current.push({
        ...entry("node:create", log),
        operation: "generation:submit" as unknown as CanvasOperation,
      })
    ).toThrow(/never on the stack/)
    expect(result.current.canUndo).toBe(false)
  })

  it("keeps the failed step on the stack and rethrows", async () => {
    const { result } = renderHook(() => useCanvasHistory())
    const failure = new Error("the write failed")
    act(() =>
      result.current.push({
        operation: "node:move",
        label: "Move node",
        undo: () => Promise.reject(failure),
        redo: () => {},
      })
    )

    await act(async () => {
      await expect(result.current.undo()).rejects.toBe(failure)
    })
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.busy).toBe(false)
  })

  it("ignores a second press while a replay is still in flight", async () => {
    const log: string[] = []
    let release: (() => void) | null = null
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const { result } = renderHook(() => useCanvasHistory())
    act(() => result.current.push(entry("node:move", log, "a")))
    act(() =>
      result.current.push({
        operation: "node:move",
        label: "b",
        undo: () => slow,
        redo: () => {},
      })
    )

    let first: Promise<void> | null = null
    await act(async () => {
      first = result.current.undo()
      // The second press lands while the first is still waiting.
      await result.current.undo()
    })
    expect(log).toEqual([])

    await act(async () => {
      release?.()
      await first
    })
    expect(result.current.depth).toBe(1)
    expect(result.current.undoLabel).toBe("a")
  })

  it("clears both stacks", async () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory())
    act(() => result.current.push(entry("node:create", log)))
    await act(async () => {
      await result.current.undo()
    })
    act(() => result.current.clear())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it("is bounded at the limit it was given", () => {
    const log: string[] = []
    const { result } = renderHook(() => useCanvasHistory(2))
    act(() => {
      result.current.push(entry("node:move", log, "a"))
    })
    act(() => {
      result.current.push(entry("node:move", log, "b"))
    })
    act(() => {
      result.current.push(entry("node:move", log, "c"))
    })
    expect(result.current.depth).toBe(2)
    expect(result.current.undoLabel).toBe("c")
  })

  it("never calls redo while undoing", async () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const { result } = renderHook(() => useCanvasHistory())
    act(() =>
      result.current.push({ operation: "node:pick", label: "Pick", undo, redo })
    )
    await act(async () => {
      await result.current.undo()
    })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()
  })
})
