"use client"

/**
 * The prompt field, with `@venkz` in it.
 *
 * It is a plain `<textarea>` and it stays one. The prompt is a string from the
 * first keystroke to `generations.prompt`, so a mention is characters in that
 * string — there is no document model to serialise, and a prompt written today
 * replays years from now because it is exactly what was submitted.
 *
 * Three parts, none of which the others need to know about:
 *
 * - the textarea, unchanged in every way that matters to the bar around it;
 * - an overlay that paints the same text with each mention in a `<mark>`, so a
 *   chip costs no editor;
 * - a listbox in a portal, anchored to the caret, so opening the picker can
 *   never change the bar's own size. The bar is anchored to a node and its
 *   width is its position: a list that pushed it would move Run under a
 *   pointer already travelling towards it.
 *
 * ⛔ Nothing here resolves a mention, attaches an image or spends anything. It
 * writes the literal text `@venkz`; `resolveMentions` decides what that means
 * for the chosen model, and the user sees that decision before they press Run.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { caretRect } from "@/lib/mentions/caret"
import {
  activeMentionQuery,
  findMentions,
  insertMention,
  type MentionQuery,
} from "@/lib/mentions/parse"
import type { MentionSubject } from "@/lib/mentions/resolve"

/** How many suggestions one popover shows. More than this is a search box. */
const MAX_OPTIONS = 8

export interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  /** Every `@`-able character and scene — `useMentionSubjects().data`. */
  subjects: readonly MentionSubject[]
  placeholder?: string
  rows?: number
  className?: string
  "aria-label"?: string
}

/**
 * Plain substring matching on the handle and the name, handle first.
 *
 * ⛔ No fuzzy fallback. A mention corrected to a near neighbour is a paid
 * mistake, so a query that matches nothing offers nothing.
 */
function matchesFor(
  subjects: readonly MentionSubject[],
  query: string
): MentionSubject[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return [...subjects].slice(0, MAX_OPTIONS)
  const scored: { subject: MentionSubject; rank: number }[] = []
  for (const subject of subjects) {
    const handle = subject.handle.toLowerCase()
    const name = subject.name.toLowerCase()
    if (handle.startsWith(needle)) scored.push({ subject, rank: 0 })
    else if (handle.includes(needle)) scored.push({ subject, rank: 1 })
    else if (name.includes(needle)) scored.push({ subject, rank: 2 })
  }
  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_OPTIONS)
    .map((one) => one.subject)
}

/** The best preview the subject has, or null when it has none. */
function subjectPreview(subject: MentionSubject): string | null {
  return (
    subject.images.find((image) => image.thumbnailUrl)?.thumbnailUrl ?? null
  )
}

/** A stable id per row, so the textarea can point `aria-activedescendant` at it. */
function optionId(listId: string, handle: string): string {
  return `${listId}-${handle}`
}

/** The text, with every mention wrapped so it reads as a chip. */
function painted(value: string) {
  const tokens = findMentions(value)
  const parts: ReactNode[] = []
  let at = 0
  for (const [index, token] of tokens.entries()) {
    if (token.start > at) parts.push(value.slice(at, token.start))
    parts.push(
      <mark
        key={`${token.start}-${index}`}
        className="rounded-sm bg-primary/15 px-0.5 text-primary"
      >
        {value.slice(token.start, token.end)}
      </mark>
    )
    at = token.end
  }
  parts.push(value.slice(at))
  return parts
}

export function MentionTextarea({
  value,
  onChange,
  subjects,
  placeholder,
  rows = 1,
  className,
  "aria-label": ariaLabel,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState<MentionQuery | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(
    null
  )
  /** Where Escape was pressed. The picker stays shut for *that* mention. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  /**
   * A caret the picker moved, applied once the new value has rendered. A ref
   * rather than state: it is a one-shot instruction to the DOM, and putting it
   * in state would be a render whose only job is to undo itself.
   */
  const pendingCaret = useRef<number | null>(null)
  /**
   * True while an IME is mid-word.
   *
   * A Japanese or Chinese keyboard sends every candidate through `change` and
   * ends the word with `Enter`. Opening the picker on those keystrokes would
   * offer a list for half-typed kana, and taking that `Enter` would swallow
   * the commit — so both are left alone until the composition ends.
   */
  const composing = useRef(false)

  const matches = query ? matchesFor(subjects, query.query) : []
  const open = query !== null && matches.length > 0

  /** Re-reads the caret and decides whether a mention is being typed. */
  const sync = useCallback(
    (text: string, at: number, justDismissed: number | null) => {
      const next = activeMentionQuery(text, at)
      if (!next || justDismissed === next.start) {
        setQuery(null)
        setAnchor(null)
        return
      }
      setQuery(next)
      setActive(0)
      const node = ref.current
      if (node) {
        const rect = caretRect(node, next.start)
        setAnchor({ left: rect.left, top: rect.bottom })
      }
    },
    []
  )

  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    const node = ref.current
    if (!node) return
    node.focus()
    node.setSelectionRange(at, at)
  }, [value])

  // The overlay is a second copy of the same text; a scrolled textarea has to
  // drag it along or the chips drift off the lines they belong to.
  useEffect(() => {
    const node = ref.current
    const mirror = overlay.current
    if (!node || !mirror) return
    mirror.scrollTop = node.scrollTop
    mirror.scrollLeft = node.scrollLeft
  }, [value])

  const choose = useCallback(
    (handle: string) => {
      if (!query) return
      const next = insertMention(value, query, handle)
      setQuery(null)
      setAnchor(null)
      setDismissed(null)
      pendingCaret.current = next.caret
      onChange(next.text)
    },
    [onChange, query, value]
  )

  return (
    <div className={cn("relative flex min-w-48 flex-1 items-stretch")}>
      {/*
        The chips. `aria-hidden` because it is the same text the textarea
        already announces, and `pointer-events-none` because every click
        belongs to the field underneath.
      */}
      <div
        ref={overlay}
        data-testid="mention-overlay"
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-2.5 py-2 text-base break-words whitespace-pre-wrap text-foreground md:text-sm",
          className
        )}
      >
        {painted(value)}
      </div>

      <Textarea
        ref={ref}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={rows}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && matches[active]
            ? optionId(listId, matches[active].handle)
            : undefined
        }
        aria-autocomplete="list"
        // The text itself lives in the overlay above; the textarea keeps the
        // caret, the selection and every key. Its own glyphs would be a second
        // copy sitting one hair off the first.
        className={cn(
          "relative bg-transparent text-transparent caret-foreground selection:bg-primary/30 selection:text-transparent",
          className
        )}
        onChange={(event) => {
          const next = event.target.value
          onChange(next)
          if (composing.current) return
          sync(next, event.target.selectionStart ?? next.length, dismissed)
        }}
        onSelect={(event) => {
          if (composing.current) return
          const node = event.currentTarget
          sync(node.value, node.selectionStart ?? node.value.length, dismissed)
        }}
        onCompositionStart={() => {
          composing.current = true
          setQuery(null)
          setAnchor(null)
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          const node = event.currentTarget
          sync(node.value, node.selectionStart ?? node.value.length, dismissed)
        }}
        onScroll={(event) => {
          const mirror = overlay.current
          if (!mirror) return
          mirror.scrollTop = event.currentTarget.scrollTop
          mirror.scrollLeft = event.currentTarget.scrollLeft
        }}
        onBlur={() => {
          setQuery(null)
          setAnchor(null)
        }}
        onKeyDown={(event) => {
          // The IME owns every key until it has committed a word.
          if (composing.current || event.nativeEvent.isComposing) return
          if (!open) return
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActive((current) => (current + 1) % matches.length)
            return
          }
          if (event.key === "ArrowUp") {
            event.preventDefault()
            setActive(
              (current) => (current - 1 + matches.length) % matches.length
            )
            return
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault()
            const chosen = matches[active] ?? matches[0]
            if (chosen) choose(chosen.handle)
            return
          }
          if (event.key === "Escape") {
            event.preventDefault()
            // Stops the canvas from reading it as "deselect this node": the
            // user meant the list in front of them.
            event.stopPropagation()
            setDismissed(query?.start ?? null)
            setQuery(null)
            setAnchor(null)
          }
        }}
      />

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              data-testid="mention-picker"
              // Fixed and portalled: the popover is laid over the page rather
              // than inside the bar, so it can never resize or shift it.
              style={{
                position: "fixed",
                left: anchor?.left ?? 0,
                top: anchor?.top ?? 0,
                zIndex: 60,
              }}
              className="w-64 overflow-hidden rounded-lg border bg-popover shadow-lg"
              // The textarea keeps the focus; a mousedown here must not take
              // it away before the click has chosen anything.
              onMouseDown={(event) => event.preventDefault()}
            >
              {/*
                A plain listbox rather than `cmdk`: the filtering, the
                highlight and every key are already this component's, so the
                library would only be supplying ids it also owns — and
                `aria-activedescendant` needs an id we can name.
              */}
              <ul id={listId} role="listbox" className="p-1">
                {matches.map((subject, index) => {
                  const preview = subjectPreview(subject)
                  return (
                    <li
                      key={subject.handle}
                      id={optionId(listId, subject.handle)}
                      role="option"
                      aria-selected={index === active}
                      data-testid="mention-option"
                      data-handle={subject.handle}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(subject.handle)}
                      className={cn(
                        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
                        index === active && "bg-muted text-foreground"
                      )}
                    >
                      <span
                        aria-hidden
                        className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-[0.6rem] text-muted-foreground"
                      >
                        {/*
                          The face, where the subject has one: a list of
                          handles is a list of words, and the picture is how
                          you recognise which Venkz this is. The glyph is the
                          fallback, not the design.
                        */}
                        {preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={preview}
                            alt=""
                            data-testid="mention-option-thumb"
                            className="size-full object-cover"
                          />
                        ) : subject.kind === "scene" ? (
                          "◻"
                        ) : (
                          "☺"
                        )}
                      </span>
                      <span className="truncate">{subject.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        @{subject.handle}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
