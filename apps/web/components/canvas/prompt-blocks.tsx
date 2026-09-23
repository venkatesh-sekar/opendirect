"use client"

/**
 * The prompt, as the blocks it is made of: the notes wired into this node,
 * dimmed, in among the user's own text blocks, in exactly the order they are
 * sent.
 *
 * The list owns no blocks. Every change — a keystroke, a drag, a "+" — is a
 * function over the current list handed to `onEdit`, which is PromptBar's
 * `editBlocks`; the rules for what a list may look like live in
 * `lib/canvas/prompt-blocks.ts` and nowhere here.
 *
 * A note is not text the user can edit in the bar: it belongs to the note on
 * the canvas. The bar lets them move it, read it, and disconnect it (✕ deletes
 * the wire, and reconcile drops the block); pointing at one lights it up on
 * the canvas, and a double-click selects it there.
 *
 * The drag has its own `DndContext`, like the container page's reference
 * strip: the shell's context carries assets onto the canvas, and a reorder
 * inside the bar is not that. The handle is the only thing that starts a
 * drag, so every text block keeps its own pointer and keyboard.
 *
 * ⛔ Nothing here submits anything. The order only decides what a later,
 * explicit Run will send.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  DragDropVerticalIcon,
  Link01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "@workspace/ui/lib/utils"

import {
  mergeIntoPrevious,
  moveBlock,
  newTextBlock,
  type DraftBlock,
  type IncomingNote,
} from "@/lib/canvas/prompt-blocks"
import type { MentionSubject } from "@/lib/mentions/resolve"

import { useCanvasSurface } from "./canvas-context"
import { MentionTextarea } from "./mention-textarea"

export interface PromptBlocksProps {
  blocks: readonly DraftBlock[]
  notesById: ReadonlyMap<string, IncomingNote>
  subjects: readonly MentionSubject[]
  /** Every edit goes through here; PromptBar's `editBlocks`. */
  onEdit: (edit: (current: DraftBlock[]) => DraftBlock[]) => void
  /** ✕ on a note: delete the wire note → this node. Reconcile drops the block. */
  onDisconnect: (noteNodeId: string) => void
}

/** What a block is called: in announcements, on its handle, in its label. */
interface BlockLabel {
  /** 1-based among notes, or among text blocks. */
  number: number
  /** True for the last text block — the one labelled plain "Prompt". */
  last: boolean
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** A block list with `block` inserted right after the block `afterId`. */
function insertAfter(
  blocks: DraftBlock[],
  afterId: string,
  block: DraftBlock
): DraftBlock[] {
  const index = blocks.findIndex((one) => one.id === afterId)
  if (index === -1) return blocks
  return [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)]
}

/** The ⋮⋮ grip, and the line that shows where a dragged block will land. */
function useBlockSortable(id: string) {
  const sortable = useSortable({ id })
  const { isOver, index, activeIndex } = sortable
  const drop: "above" | "below" | null =
    isOver && activeIndex !== -1 && activeIndex !== index
      ? activeIndex < index
        ? "below"
        : "above"
      : null
  return { ...sortable, drop }
}

function DropLine({ at }: { at: "above" | "below" | null }) {
  if (!at) return null
  return (
    <span
      aria-hidden
      data-testid="block-drop-line"
      className={cn(
        "pointer-events-none absolute right-0 left-7 h-0.5 rounded-full bg-primary",
        at === "above" ? "-top-px" : "-bottom-px"
      )}
    />
  )
}

type Sortable = ReturnType<typeof useBlockSortable>

/** The ⋮⋮ grip: the only thing a drag starts from. */
function Handle({
  label,
  activatorRef,
  attributes,
  listeners,
}: {
  label: string
  activatorRef: Sortable["setActivatorNodeRef"]
  attributes: Sortable["attributes"]
  listeners: Sortable["listeners"]
}) {
  return (
    <button
      type="button"
      ref={activatorRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      className="absolute top-1.5 left-1 flex size-5 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <HugeiconsIcon icon={DragDropVerticalIcon} className="size-3.5" />
    </button>
  )
}

/** The hover "+" both kinds of block carry. */
function InsertButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Insert text below"
      title="Insert text below"
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
    </button>
  )
}

function NoteBlock({
  block,
  note,
  label,
  onInsert,
  onDisconnect,
  onHover,
  onSelect,
}: {
  block: Extract<DraftBlock, { kind: "note" }>
  note: IncomingNote | undefined
  label: BlockLabel
  onInsert: () => void
  onDisconnect: () => void
  onHover: (nodeId: string | null) => void
  onSelect: () => void
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
    drop,
  } = useBlockSortable(block.id)
  const [expanded, setExpanded] = useState(false)
  const title = note?.title ?? "Note"
  const text = note?.text ?? ""
  const empty = text.trim() === ""

  return (
    <li
      ref={setNodeRef}
      data-block-id={block.id}
      data-kind="note"
      className={cn(
        "group relative flex min-h-8 items-start gap-1 rounded-md py-1 pr-1 pl-7 hover:bg-muted/60",
        isDragging && "opacity-40"
      )}
    >
      <DropLine at={drop} />
      <Handle
        label={`Move note ${label.number}`}
        activatorRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
      />
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Note ${label.number}, ${title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => setExpanded((open) => !open)}
        onDoubleClick={onSelect}
        onMouseEnter={() => onHover(block.nodeId)}
        onMouseLeave={() => onHover(null)}
        onKeyDown={(event) => {
          // Only the row itself: a key inside anything nested is not a
          // request to disconnect.
          if (event.target !== event.currentTarget) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setExpanded((open) => !open)
            return
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault()
            onDisconnect()
          }
        }}
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] font-medium text-muted-foreground">
          {label.number}
        </span>
        <span className="flex h-6 shrink-0 items-center gap-1 text-xs font-medium">
          <HugeiconsIcon icon={Link01Icon} className="size-3" />
          {title}
        </span>
        {empty ? (
          <span className="min-w-0 flex-1 text-sm leading-6 italic">
            Empty — adds nothing
          </span>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 text-sm leading-6",
              expanded ? "whitespace-pre-wrap" : "truncate"
            )}
          >
            {text}
          </span>
        )}
        <span className="flex h-6 shrink-0 items-center font-mono text-[11px] tabular-nums">
          {wordCount(text)}w
        </span>
      </div>
      <InsertButton onClick={onInsert} />
      <button
        type="button"
        aria-label={`Disconnect ${title}`}
        title="Disconnect (the note stays on the canvas)"
        onClick={onDisconnect}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
      </button>
    </li>
  )
}

function TextBlock({
  block,
  label,
  subjects,
  register,
  onChange,
  onKeyDown,
  onInsert,
}: {
  block: Extract<DraftBlock, { kind: "text" }>
  label: BlockLabel
  subjects: readonly MentionSubject[]
  /** Where the list keeps this block's field, to move the focus into it. */
  register: (id: string, node: HTMLTextAreaElement | null) => void
  onChange: (text: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onInsert: () => void
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
    drop,
  } = useBlockSortable(block.id)
  const id = block.id
  const textareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => register(id, node),
    [id, register]
  )
  return (
    <li
      ref={setNodeRef}
      data-block-id={block.id}
      data-kind="text"
      className={cn(
        "group relative flex min-h-8 items-start gap-1 rounded-md py-0.5 pr-1 pl-7",
        isDragging && "opacity-40"
      )}
    >
      <DropLine at={drop} />
      <Handle
        label="Move text block"
        activatorRef={setActivatorNodeRef}
        attributes={attributes}
        listeners={listeners}
      />
      <MentionTextarea
        aria-label={label.last ? "Prompt" : `Prompt, part ${label.number}`}
        placeholder={label.last ? "Type here, or drag a note in…" : "Type…"}
        rows={1}
        value={block.text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        textareaRef={textareaRef}
        subjects={subjects}
        // Grows with its text and then scrolls; the bar grows downward, so
        // nothing above it moves.
        className="field-sizing-content max-h-64 min-h-8 resize-none overflow-y-auto border-0 px-1 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <InsertButton onClick={onInsert} />
    </li>
  )
}

export function PromptBlocks({
  blocks,
  notesById,
  subjects,
  onEdit,
  onDisconnect,
}: PromptBlocksProps) {
  const surface = useCanvasSurface()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  /** Numbers and labels, worked out once per list rather than per block. */
  const labels = new Map<string, BlockLabel>()
  let lastText = blocks.length - 1
  while (lastText >= 0 && blocks[lastText]!.kind !== "text") lastText -= 1
  let notes = 0
  let texts = 0
  for (const [index, block] of blocks.entries()) {
    const number = block.kind === "note" ? ++notes : ++texts
    labels.set(block.id, { number, last: index === lastText })
  }

  /* ---- focus --------------------------------------------------------- */

  const fields = useRef(new Map<string, HTMLTextAreaElement>())
  const register = useCallback(
    (id: string, node: HTMLTextAreaElement | null) => {
      if (node) fields.current.set(id, node)
      else fields.current.delete(id)
    },
    []
  )
  /**
   * A block to focus once the list that holds it has rendered — the one "+"
   * made, or the one Backspace merged into. A ref, not state: it is a one-shot
   * instruction to the DOM.
   */
  const pendingFocus = useRef<{ id: string; atEnd: boolean } | null>(null)
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    // One try, on the first list after the edit: a block that is not in it
    // was merged away, and a later list must not steal the caret for it.
    pendingFocus.current = null
    const field = fields.current.get(pending.id)
    if (!field) return
    field.focus()
    const at = pending.atEnd ? field.value.length : 0
    field.setSelectionRange(at, at)
  }, [blocks])

  /* ---- the canvas highlight ----------------------------------------- */

  const highlightNote = surface?.highlightNote
  const hovered = useRef<string | null>(null)
  const hover = useCallback(
    (nodeId: string | null) => {
      hovered.current = nodeId
      highlightNote?.(nodeId)
    },
    [highlightNote]
  )
  // A note disconnected under the pointer never sees its mouseleave.
  useEffect(() => {
    const id = hovered.current
    if (id && !blocks.some((b) => b.kind === "note" && b.nodeId === id))
      hover(null)
  }, [blocks, hover])
  useEffect(
    () => () => {
      if (hovered.current !== null) highlightNote?.(null)
    },
    [highlightNote]
  )

  /* ---- edits ---------------------------------------------------------- */

  const insertBelow = (afterId: string) => {
    const block = newTextBlock()
    pendingFocus.current = { id: block.id, atEnd: false }
    onEdit((current) => insertAfter(current, afterId, block))
  }

  const setText = (id: string, text: string) =>
    onEdit((current) =>
      current.map((block) =>
        block.id === id && block.kind === "text" ? { ...block, text } : block
      )
    )

  const onTextKeyDown = (
    id: string,
    event: KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key !== "Backspace") return
    const field = event.currentTarget
    if (field.value !== "" || field.selectionStart !== 0) return
    const merged = mergeIntoPrevious(blocks, id)
    if (!merged.focus) return
    event.preventDefault()
    pendingFocus.current = { id: merged.focus, atEnd: true }
    onEdit((current) => mergeIntoPrevious(current, id).blocks)
  }

  /* ---- drag ------------------------------------------------------------ */

  const describe = (id: UniqueIdentifier): string => {
    const block = blocks.find((one) => one.id === id)
    if (!block || block.kind === "text") return "Text block"
    const number = labels.get(block.id)?.number ?? 0
    const title = notesById.get(block.nodeId)?.title ?? "Note"
    return `Note ${number}, ${title},`
  }
  const position = (id: UniqueIdentifier) =>
    `position ${blocks.findIndex((one) => one.id === id) + 1} of ${blocks.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${describe(active.id)} at ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${describe(active.id)} moved to ${position(over.id)}.`
        : `${describe(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${describe(active.id)} moved to ${position(over.id)}.`
        : `${describe(active.id)} dropped.`,
    onDragCancel: ({ active }) =>
      `Moving ${describe(active.id)} was cancelled.`,
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onEdit((current) => moveBlock(current, String(active.id), String(over.id)))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext
        items={blocks.map((block) => block.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol
          aria-label="Prompt blocks"
          className="flex min-w-48 flex-1 flex-col gap-0.5"
        >
          {blocks.map((block) => {
            const label = labels.get(block.id)!
            return block.kind === "note" ? (
              <NoteBlock
                key={block.id}
                block={block}
                note={notesById.get(block.nodeId)}
                label={label}
                onInsert={() => insertBelow(block.id)}
                onDisconnect={() => onDisconnect(block.nodeId)}
                onHover={hover}
                onSelect={() => surface?.selectNode?.(block.nodeId)}
              />
            ) : (
              <TextBlock
                key={block.id}
                block={block}
                label={label}
                subjects={subjects}
                register={register}
                onChange={(text) => setText(block.id, text)}
                onKeyDown={(event) => onTextKeyDown(block.id, event)}
                onInsert={() => insertBelow(block.id)}
              />
            )
          })}
        </ol>
      </SortableContext>
    </DndContext>
  )
}
