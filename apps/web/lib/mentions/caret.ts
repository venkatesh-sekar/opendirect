/**
 * Where the caret is, in viewport coordinates.
 *
 * A `<textarea>` publishes no caret geometry, so the standard trick is the
 * only one available: clone the textarea's own computed style into an
 * offscreen `<div>`, put the text up to the caret in it, and measure a
 * zero-width span sitting exactly where the next character would go.
 *
 * ⛔ Positioning only. Nothing here reads or changes the prompt, and a
 * measurement that fails is not an error the user should ever see: the
 * fallback is the textarea's own rect, so the picker opens at the bottom-left
 * of the field rather than not at all.
 */

/**
 * The properties that decide where a glyph lands. Copied wholesale so the
 * mirror wraps its text exactly where the textarea does — a single missing
 * property (`letter-spacing`, a padding) moves the caret by a character.
 */
const MIRRORED = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "fontVariant",
  "letterSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "wordSpacing",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
  "tabSize",
] as const

/**
 * A zero-size rect at the caret, in viewport coordinates.
 *
 * The rect's height is one line, so a popover placed at `bottom` sits under
 * the line being typed rather than over it.
 */
export function caretRect(
  textarea: HTMLTextAreaElement,
  index: number
): DOMRect {
  const own = textarea.getBoundingClientRect()
  const view = textarea.ownerDocument.defaultView
  if (!view) return own

  let mirror: HTMLDivElement | null = null
  try {
    const style = view.getComputedStyle(textarea)
    mirror = textarea.ownerDocument.createElement("div")
    for (const property of MIRRORED) {
      mirror.style[property] = style[property] as string
    }
    // The mirror must wrap like a textarea and must not be seen or measured
    // by anything else on the page.
    mirror.style.position = "absolute"
    mirror.style.top = "0"
    mirror.style.left = "0"
    mirror.style.visibility = "hidden"
    mirror.style.whiteSpace = "pre-wrap"
    mirror.style.overflowWrap = "break-word"
    mirror.style.pointerEvents = "none"

    const head = textarea.ownerDocument.createTextNode(
      textarea.value.slice(0, index)
    )
    const marker = textarea.ownerDocument.createElement("span")
    // A non-empty span: an empty one has no box to measure.
    marker.textContent = textarea.value.slice(index) || "."
    mirror.append(head, marker)
    textarea.ownerDocument.body.append(mirror)

    const at = marker.getBoundingClientRect()
    const box = mirror.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return own

    const left = own.left + (at.left - box.left) - textarea.scrollLeft
    const top = own.top + (at.top - box.top) - textarea.scrollTop
    const lineHeight = Number.parseFloat(style.lineHeight) || at.height || 16
    return new DOMRect(left, top, 0, lineHeight)
  } catch {
    // jsdom, a detached node, a browser that refuses the clone — the textarea
    // itself is always a truthful anchor.
    return own
  } finally {
    mirror?.remove()
  }
}
