/**
 * Which container new canvas nodes are filed under.
 *
 * A run belongs to a container, and a generate node reads its batch back from
 * the one it was filed under, so the canvas always needs an answer. It used to
 * be the sidebar's selection; the sidebar navigates now, so the answer is the
 * container the user last *went to* — a `/container/?id=` page or a
 * `/canvas/?focus=` — remembered across reloads. Only when there is none, or it
 * has since been deleted, does the first container in the tree stand in.
 */
import type { ContainerNodeDto } from "@opendirect/contract"

import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"

const STORAGE_KEY = "opendirect.filingContainer"

let last: string | null = null
let loaded = false

/** Storage can throw (a locked-down profile, a prerender with no window). */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function rememberFilingContainer(id: string): void {
  last = id
  loaded = true
  try {
    storage()?.setItem(STORAGE_KEY, id)
  } catch {
    // Remembered for this session only; nothing else depends on it.
  }
}

export function lastFilingContainer(): string | null {
  if (!loaded) {
    loaded = true
    try {
      last = storage()?.getItem(STORAGE_KEY) ?? null
    } catch {
      last = null
    }
  }
  return last
}

/** For tests: a window that has never visited a container. */
export function forgetFilingContainer(): void {
  last = null
  loaded = true
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to forget.
  }
}

/** The focus if it is real, else the last container visited, else the first. */
export function filingContainerId(
  tree: ContainerNodeDto[],
  focus: string | null
): string | null {
  if (focus && findContainer(tree, focus)) return focus
  const remembered = lastFilingContainer()
  if (remembered && findContainer(tree, remembered)) return remembered
  return firstSelectableContainer(tree)?.id ?? null
}
