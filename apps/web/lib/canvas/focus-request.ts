let requested: string | null = null
const listeners = new Set<() => void>()
export function requestCanvasFocus(id: string) {
  requested = id
  for (const listener of listeners) listener()
}
export function subscribeCanvasFocus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function pendingCanvasFocus() {
  return requested
}
export function clearCanvasFocus(id: string) {
  if (requested === id) requested = null
}
