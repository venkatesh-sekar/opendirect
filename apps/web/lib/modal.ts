/**
 * Is a modal surface open right now?
 *
 * Asked by the one global shortcut that spends money. ⌘Enter is registered on
 * the creation bar with `enableOnFormTags`, which means it fires from anywhere
 * in the window — including from inside the reference picker, the advanced
 * parameters dialog, the AI result dialog and the job sheet, where Enter means
 * something else entirely and Generate is not what the user is looking at.
 *
 * The test is presence, not a flag: Base UI (and every other modal library the
 * app uses) unmounts a dialog's content when it closes, so a `role="dialog"`
 * element in the document is an open one. That keeps this working for dialogs
 * that have not been written yet, which a hand-maintained list of open-state
 * booleans would not.
 */
const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"]'

export function hasOpenModal(root: ParentNode | null | undefined): boolean {
  if (!root) return false
  const found = root.querySelector(MODAL_SELECTOR)
  if (!found) return false
  // A library that keeps its content mounted marks the closed state instead of
  // removing the node, so an explicit "closed" is believed over mere presence.
  return found.getAttribute("data-state") !== "closed"
}

/** The same question, of the live document. Safe to call during SSR. */
export function isModalOpen(): boolean {
  return typeof document !== "undefined" && hasOpenModal(document)
}
