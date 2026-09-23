"use client"

/**
 * Exactly what gets sent: the prompt the provider receives, and which input
 * each picture goes to.
 *
 * The panel computes nothing about the prompt. It is handed
 * `useGeneratePlan().mentions.prompt` — the blocks joined *and* the
 * `@mentions` substituted, the very string the request carries and
 * `generations.prompt` records — and the block ranges already carried through
 * that substitution. So what is read here cannot drift from what is run: there
 * is no second renderer to fall out of step.
 *
 * ⛔ Nothing here submits or spends. Copy writes to the clipboard; a chip opens
 * a gallery.
 */
import { useEffect, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** How long Copy says "Copied" before it says Copy again. */
const COPIED_FOR_MS = 1400

export interface FullPromptPanelProps {
  /** The element id, for the toggle's `aria-controls`. */
  id?: string
  /** `useGeneratePlan().mentions.prompt` — resolved, the string the provider receives. */
  prompt: string
  /** Ranges into `prompt`, already mapped through mentions, tagged with block kind. */
  segments: { start: number; end: number; kind: "note" | "text" }[]
  noteCount: number
  /** One chip per slot that will carry images: field + count. */
  inputs: { field: string; label: string; count: number }[]
  onOpenInput: (field: string) => void
}

interface Piece {
  key: string
  text: string
  /** Null for what lies between blocks — the separator. */
  kind: "note" | "text" | null
}

/**
 * `prompt` cut at the segment boundaries. Every character lands in exactly one
 * piece, so the pieces joined are `prompt` itself, whatever the ranges say.
 */
function cut(
  prompt: string,
  segments: FullPromptPanelProps["segments"]
): Piece[] {
  const pieces: Piece[] = []
  let cursor = 0
  const between = (end: number) => {
    if (end > cursor) {
      pieces.push({
        key: `gap-${cursor}`,
        text: prompt.slice(cursor, end),
        kind: null,
      })
      cursor = end
    }
  }
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const start = Math.max(cursor, Math.min(segment.start, prompt.length))
    const end = Math.max(start, Math.min(segment.end, prompt.length))
    between(start)
    if (end === start) continue
    pieces.push({
      key: `${segment.kind}-${start}`,
      text: prompt.slice(start, end),
      kind: segment.kind,
    })
    cursor = end
  }
  between(prompt.length)
  return pieces
}

function wordCount(prompt: string): number {
  const trimmed = prompt.trim()
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length
}

export function FullPromptPanel({
  id,
  prompt,
  segments,
  noteCount,
  inputs,
  onOpenInput,
}: FullPromptPanelProps) {
  const [highlight, setHighlight] = useState(true)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** False once unmounted: a clipboard write can settle after the panel closes. */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      /* A refused clipboard is not worth an error on a read-out. */
    }
    if (!mounted.current) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS)
  }

  const images = inputs.reduce((sum, input) => sum + input.count, 0)

  return (
    // `nokey`: React Flow listens for Space and Backspace on the whole
    // document; the checkbox and the buttons here are not the canvas's.
    <section
      id={id}
      data-testid="full-prompt-panel"
      aria-label="Full prompt"
      className="nokey flex flex-col gap-2 border-t px-1 pt-2"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Exactly what gets sent
        </span>
        <span
          data-testid="full-prompt-stats"
          className="font-mono text-xs text-muted-foreground tabular-nums"
        >
          {prompt.length} chars · {wordCount(prompt)} words · {noteCount} notes
          · {images} images
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={highlight}
            onChange={(event) => setHighlight(event.target.checked)}
          />
          Highlight notes
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="w-16"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div
        data-testid="full-prompt"
        className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap"
      >
        {prompt === "" ? (
          <span className="text-muted-foreground">
            Nothing yet — type or connect a note.
          </span>
        ) : (
          cut(prompt, segments).map((piece) =>
            piece.kind === "note" ? (
              <span
                key={piece.key}
                data-from-note=""
                className={cn(
                  highlight && "rounded-sm bg-primary/10 text-foreground"
                )}
              >
                {piece.text}
              </span>
            ) : (
              <span key={piece.key}>{piece.text}</span>
            )
          )
        )}
      </div>

      {inputs.length > 0 ? (
        <div
          data-testid="full-prompt-inputs"
          className="flex flex-wrap gap-1.5"
        >
          {inputs.map((input) => (
            <Button
              key={input.field}
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              aria-label={`${input.field} × ${input.count}, open ${input.label}`}
              title={`Open ${input.label}`}
              onClick={() => onOpenInput(input.field)}
            >
              <span className="font-mono">{input.field}</span>
              <span>× {input.count}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
