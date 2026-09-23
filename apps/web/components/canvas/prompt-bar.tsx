"use client"

/**
 * The bar under the selected generate node: everything a run needs, and
 * nothing that is not this node's.
 *
 * It is the creation bar's job on a canvas, and it is deliberately the same
 * job done by the same parts — `ModelPicker`, `AdvancedParams`,
 * `ReferencePicker`, `buildGenerationRequest`, `cost:estimate`. What changes
 * is where the references come from: on the canvas they are the node's
 * incoming edges, read by `edgesToInputs`, so the tray is a view of the graph
 * rather than a second selection the graph does not know about.
 *
 * **Draft state is per node and it lives here.** A prompt half typed on one
 * node must still be there after the user clicks another node and comes back,
 * and it must never leak into that other node's request. So the drafts live in
 * a tiny module store keyed by node id, subscribed to with
 * `useSyncExternalStore` — the canvas is free to unmount the bar between
 * selections without losing what was typed.
 *
 * Drafts stay in memory while editing. Save prompt explicitly records the
 * prompt, model, settings and count on the node; workflow exports include them.
 *
 * What a run *is* — mentions, request, quote, batch plan, why it is blocked —
 * is `useGeneratePlan`, shared with a container page's generate panel. This
 * file adds what only the canvas has: the node's edges, its per-node draft and
 * the writes back onto the node.
 *
 * ⛔ Run is the only thing in this file that spends money, and it spends it
 * once: `useGeneratePlan().run` is called exactly once per click and the
 * button is disabled while it is in flight. Everything else — the model chip,
 * the settings grid, the count stepper, the cost line — describes a run that
 * has not happened.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  MinusSignIcon,
  PlusSignIcon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons"
import {
  promptRecipeSchema,
  type PromptBlock,
  type PromptRecipe,
  type CanvasDto,
  type CanvasNodeDto,
  type ModelKind,
} from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { useAiHelper, useAiTools } from "@/hooks/use-ai"
import { useContainerTree } from "@/hooks/use-containers"
import {
  useDeleteCanvasEdges,
  useUpdateCanvasEdge,
  useUpdateCanvasNode,
} from "@/hooks/use-canvas"
import { MAX_BATCH, useGeneratePlan } from "@/hooks/use-generate-plan"
import { useModel } from "@/hooks/use-models"
import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"
import {
  edgesToInputs,
  incomingEdges,
  incomingNotes,
} from "@/lib/canvas/edges-to-inputs"
import {
  appendText,
  reconcileBlocks,
  renderPromptBlocks,
  replaceText,
  textOfBlocks,
  type DraftBlock,
} from "@/lib/canvas/prompt-blocks"
import { contributedKind, firstFreeSlot } from "@/lib/canvas/slots"
import type { IconGrid } from "@/lib/canvas/icon-grid"
import { buildIconGrid, withoutIconGridFields } from "@/lib/canvas/icon-grid"
import { frameSize, parseAspectRatio } from "@/lib/canvas/layout"
import { modelDefaults } from "@/lib/create/draft"
import { splitSchema } from "@/lib/schema-form/split-schema"

import { HelperMenu } from "@/components/ai/helper-menu"
import { HelperResultDialog } from "@/components/ai/helper-result-dialog"
import { AdvancedParams } from "@/components/create/advanced-params"
import { CostBadge } from "@/components/create/cost-badge"
import { ModelPicker } from "@/components/models/model-picker"

import { useCanvasSurface } from "./canvas-context"
import { PromptBlocks } from "./prompt-blocks"
import { CanvasReferenceStrip, MentionNotes } from "./reference-tray"
import { SettingsPopover } from "./settings-popover"

/**
 * Stands in for a model that promotes no grid rows, so the popover still has a
 * shape to render when it is only carrying the narrow-width overflow.
 */
const EMPTY_GRID: IconGrid = { rows: [], fields: [] }

export { MAX_BATCH }

/** One node's unsubmitted composition. */
interface PromptDraft {
  /** The user's own words: the text blocks joined, never the notes. */
  prompt: string
  /**
   * Where the notes sit among the text. Undefined for a recipe saved before
   * blocks existed, which reads as its notes in wire order and then `prompt`.
   * A block loaded from a saved recipe has no id until `reconcileBlocks`
   * gives it one.
   */
  blocks?: (PromptBlock & { id?: string })[]
  modelKey: string | null
  /** Promoted controls and the icon grid's fields, by the model's own names. */
  common: Record<string, unknown>
  /** The Advanced form's object. */
  advanced: Record<string, unknown>
  count: number
  /** The model whose defaults `common`/`advanced` were seeded from. */
  seededFor: string | null
}

const EMPTY_DRAFT: PromptDraft = {
  prompt: "",
  blocks: undefined,
  modelKey: null,
  common: {},
  advanced: {},
  count: 1,
  seededFor: null,
}

/**
 * The drafts, keyed by node id.
 *
 * A module store rather than component state because the bar is mounted and
 * unmounted as the selection moves, and a draft that vanished when the user
 * clicked away to look at a reference would be the app throwing away their
 * words. It is memory only — see the file header.
 */
const drafts = new Map<string, PromptDraft>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Fills a node's draft before its bar has ever been mounted — what "Branch
 * from this run" does with the run it branched from.
 *
 * ⛔ It seeds a *composition*, not a run: the user still presses Run. The
 * model is carried across so the branch starts from the same one, and the
 * parameters are left to reseed from that model's own defaults.
 */
export function seedPromptDraft(
  nodeId: string,
  seed: { prompt: string; modelKey: string | null }
): void {
  drafts.set(nodeId, {
    ...EMPTY_DRAFT,
    prompt: seed.prompt,
    // The branch starts in the legacy order: its notes, then this prompt.
    blocks: undefined,
    modelKey: seed.modelKey,
  })
  emit()
}

/**
 * A block edit, written back into a draft.
 *
 * A legacy draft — one whose recipe never ordered its notes — stays legacy for
 * as long as the edit leaves it in the legacy shape (its notes in wire order,
 * then one text block): typing or applying an answer keeps only `prompt`, as
 * typed, trailing space and all, so saving alone never pins a note order. Any
 * other edit records the blocks, and `prompt` becomes their text joined.
 */
function withBlocks(
  current: PromptDraft,
  edit: (blocks: DraftBlock[]) => DraftBlock[],
  noteIds: readonly string[]
): PromptDraft {
  const base = reconcileBlocks({
    blocks: current.blocks,
    prompt: current.prompt,
    noteIds,
  })
  const next = edit(base)
  if (current.blocks === undefined) {
    const text = legacyText(next, noteIds)
    if (text !== null) return { ...current, prompt: text }
  }
  return { ...current, blocks: next, prompt: textOfBlocks(next) }
}

/** The one text block's words, when `blocks` is the legacy order; else null. */
function legacyText(
  blocks: readonly DraftBlock[],
  noteIds: readonly string[]
): string | null {
  if (blocks.length !== noteIds.length + 1) return null
  const matches = noteIds.every((nodeId, index) => {
    const block = blocks[index]!
    return block.kind === "note" && block.nodeId === nodeId
  })
  const last = blocks.at(-1)!
  return matches && last.kind === "text" ? last.text : null
}

/** Test seam: a fresh canvas between tests must not inherit yesterday's draft. */
export function clearPromptDrafts(): void {
  drafts.clear()
  emit()
}

export function readPromptRecipe(node: CanvasNodeDto): PromptRecipe {
  const current = drafts.get(node.id)
  if (current) return promptRecipeSchema.parse(current)
  if (node.text) {
    try {
      const parsed = promptRecipeSchema.safeParse(JSON.parse(node.text))
      if (parsed.success) return parsed.data
    } catch {
      /* Older nodes can contain plain text. */
    }
  }
  return {
    prompt: node.generation?.prompt ?? "",
    modelKey: node.modelKey,
    common: {},
    advanced: {},
    count: 1,
  }
}

function useDraft(
  nodeId: string,
  initial: PromptDraft = EMPTY_DRAFT
): [PromptDraft, (edit: (draft: PromptDraft) => PromptDraft) => void] {
  const draft = useSyncExternalStore(
    subscribe,
    () => drafts.get(nodeId) ?? EMPTY_DRAFT,
    () => EMPTY_DRAFT
  )
  const update = useCallback(
    (edit: (current: PromptDraft) => PromptDraft) => {
      drafts.set(nodeId, edit(drafts.get(nodeId) ?? initial))
      emit()
    },
    [nodeId, initial]
  )
  return [draft, update]
}

/**
 * The modalities a node of this type may run.
 *
 * Two frozen arrays rather than a fresh one per call: the picker keeps this in
 * a hotkey dependency list, so a new array on every render re-bound the
 * catalog chord on every keystroke.
 */
const VIDEO_KINDS: ModelKind[] = ["video"]
const IMAGE_KINDS: ModelKind[] = ["image"]

function kindsFor(node: CanvasNodeDto): ModelKind[] {
  return node.type === "video_gen" ? VIDEO_KINDS : IMAGE_KINDS
}

export interface PromptBarProps {
  /** The selected generate node. */
  node: CanvasNodeDto
  /** The whole surface, for the edges feeding this node. */
  canvas: CanvasDto
  /**
   * Seeds the model on a node the user has not chosen one for — the saved
   * default, exactly as the creation bar takes one. Optional: the canvas may
   * pass nothing and the bar simply asks for a model.
   */
  defaultModelKey?: string | null
}

export function PromptBar({ node, canvas, defaultModelKey }: PromptBarProps) {
  const persisted = useMemo(() => {
    const recipe = readPromptRecipe(node)
    return { ...recipe, seededFor: node.text ? recipe.modelKey : null }
  }, [node])
  const [storedDraft, updateDraft] = useDraft(node.id, persisted)
  const stored = storedDraft === EMPTY_DRAFT ? persisted : storedDraft
  const draft = useMemo(
    () =>
      stored.modelKey === null && defaultModelKey
        ? { ...stored, modelKey: defaultModelKey }
        : stored,
    [defaultModelKey, stored]
  )
  /** Stable by node type: the picker keeps it in a hotkey dependency list. */
  const kinds = useMemo(() => kindsFor(node), [node])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Whose gallery is open under the strip — a slot field, or null. */
  const [galleryFor, setGalleryFor] = useState<string | null>(null)

  const model = useModel(draft.modelKey)
  const descriptor = model.data

  /**
   * Where a run's outputs are filed. The canvas is the workspace, but a
   * generation still belongs to a container in the sidebar, so it is the
   * project's first container — the same one the board opened on.
   */
  const tree = useContainerTree()
  const surface = useCanvasSurface()
  const workspaceContainerId =
    node.containerId ??
    node.generation?.containerId ??
    surface?.containerId ??
    null
  const container = useMemo(() => {
    const nodes = tree.data ?? []
    // The container the sidebar is pointed at, which is also the one the node
    // reads its outputs back from (`GenerateNodeBody`). Filing a run anywhere
    // else would submit it and then show an empty node.
    const selected = workspaceContainerId
      ? findContainer(nodes, workspaceContainerId)
      : null
    return selected ?? firstSelectableContainer(nodes) ?? null
  }, [workspaceContainerId, tree.data])
  const containerId = container?.id ?? null

  /**
   * The AI helpers, which are here only if the user already has a `claude` or
   * `codex` CLI installed — `<HelperMenu/>` renders nothing at all otherwise.
   *
   * ⛔ Neither helper touches the prompt by itself: the answer opens in a
   * dialog and Apply is a button the user presses.
   */
  const aiTools = useAiTools()
  const ai = useAiHelper()

  const split = useMemo(
    () => (descriptor ? splitSchema(descriptor) : null),
    [descriptor]
  )
  const grid = useMemo(
    () => (descriptor ? buildIconGrid(descriptor) : null),
    [descriptor]
  )

  /**
   * A model change reseeds the parameters from *that* model's own defaults and
   * leaves the prompt alone. Carrying a value across models would quietly send
   * a parameter the new model never declared.
   */
  const seededFor = draft.seededFor
  useEffect(() => {
    if (!descriptor || seededFor === descriptor.key) return
    updateDraft((current) => ({
      ...current,
      ...modelDefaults(descriptor),
      seededFor: descriptor.key,
    }))
  }, [descriptor, seededFor, updateDraft])

  /**
   * Step 1 of the run flow: the node's incoming edges become references and
   * notes, or a sentence saying why they cannot.
   */
  const inputs = useMemo(
    () =>
      edgesToInputs({
        targetNodeId: node.id,
        nodes: canvas.nodes,
        edges: canvas.edges,
        slots: descriptor?.referenceSlots ?? [],
      }),
    [canvas.edges, canvas.nodes, descriptor, node.id]
  )

  /**
   * The prompt that is sent: the notes wired in and the user's text, in the
   * order the blocks give them. Read from the wires directly rather than from
   * `inputs`, so the notes still show while an upstream node blocks the run.
   */
  const notes = useMemo(
    () =>
      incomingNotes({
        targetNodeId: node.id,
        nodes: canvas.nodes,
        edges: canvas.edges,
      }),
    [canvas.edges, canvas.nodes, node.id]
  )
  const noteIds = useMemo(() => notes.map((note) => note.nodeId), [notes])
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.nodeId, note])),
    [notes]
  )
  const blocks = useMemo(
    () =>
      reconcileBlocks({
        blocks: draft.blocks,
        prompt: draft.prompt,
        noteIds,
      }),
    [draft.blocks, draft.prompt, noteIds]
  )
  const rendered = useMemo(
    () => renderPromptBlocks(blocks, notesById),
    [blocks, notesById]
  )

  /**
   * The one way the prompt changes — typing, a drag, "+", Apply and Insert —
   * each an edit over the reconciled blocks, so what is shown, sent and saved
   * is always the same list.
   */
  const editBlocks = useCallback(
    (edit: (current: DraftBlock[]) => DraftBlock[]) => {
      updateDraft((current) => withBlocks(current, edit, noteIds))
    },
    [noteIds, updateDraft]
  )

  /** "Insert shot": onto the end of the last text block. */
  const appendToPrompt = useCallback(
    (text: string) => editBlocks((current) => appendText(current, text)),
    [editBlocks]
  )

  /**
   * ✕ on a note: the wire goes, the note stays on the canvas, and reconcile
   * drops its block. On a canvas it is the canvas's own undoable edge delete;
   * a bar rendered on its own (a test, a preview) deletes the edge directly.
   * ⛔ An edge delete; nothing is run.
   */
  const deleteEdges = useDeleteCanvasEdges()
  const deleteEdgesMutate = deleteEdges.mutate
  const surfaceDisconnect = surface?.disconnectNote
  const disconnectNote = useCallback(
    (noteNodeId: string) => {
      if (surfaceDisconnect) return surfaceDisconnect(noteNodeId, node.id)
      const ids = incomingEdges(canvas.edges, node.id)
        .filter((edge) => edge.sourceNodeId === noteNodeId)
        .map((edge) => edge.id)
      if (ids.length > 0) deleteEdgesMutate(ids)
    },
    [canvas.edges, deleteEdgesMutate, node.id, surfaceDisconnect]
  )

  /**
   * Step 2 onwards — mentions, request, quote, batch plan — is the same for
   * every composer, and it is `useGeneratePlan`'s.
   */
  const {
    subjects,
    mentions,
    request,
    cost,
    total,
    plan,
    blockedReason,
    disabledReason,
    unknownCost,
    acceptedUnknownCost,
    acceptUnknownCost,
    canRun,
    submission,
    run: submitRun,
  } = useGeneratePlan({
    draft,
    descriptor,
    modelPending: model.isPending,
    kinds,
    containerId,
    inputs,
    prompt: rendered.prompt,
    scope: node.id,
  })

  /**
   * The stepper stops at `MAX_BATCH` and nowhere else.
   *
   * Deliberately *not* capped at the model's own `maximum`: a model that caps
   * one prediction at four can still produce ten, as three jobs of 4, 4 and 2.
   * That is `planBatch`'s split, and `runs` above is what tells the user it
   * happened — the cap belongs on what one click may spend, not on what one
   * prediction may hold.
   */
  const maxCount = MAX_BATCH

  const updateNode = useUpdateCanvasNode()
  const updateEdge = useUpdateCanvasEdge()

  /**
   * The chosen model, written onto the node itself.
   *
   * The draft is this window's memory; the *row* is what the rest of the
   * canvas reads. `modelKeyOfNode` resolves a new edge's slot from it and the
   * edge label's slot menu lists the same model's slots — neither of which can
   * see a draft, and neither of which can wait for the node's first run.
   *
   * ⛔ It records a choice, not a run. Nothing here queues anything.
   */
  const chosenModelKey = draft.modelKey
  const updateNodeMutate = updateNode.mutate
  useEffect(() => {
    if (!chosenModelKey) return
    if (node.modelKey === chosenModelKey) return
    updateNodeMutate({ id: node.id, patch: { modelKey: chosenModelKey } })
  }, [chosenModelKey, node.id, node.modelKey, updateNodeMutate])

  /**
   * Edges drawn before this node had a model.
   *
   * A slot could not be guessed then — there were no slots to guess from — so
   * the edge was written unresolved. Now that the model is known, the same
   * rule `connect()` uses assigns one, rather than leaving the user with an
   * error whose only remedy is to re-label every wire by hand.
   */
  const slots = descriptor?.referenceSlots
  const updateEdgeMutate = updateEdge.mutate
  useEffect(() => {
    if (!slots || slots.length === 0) return
    const byId = new Map(canvas.nodes.map((one) => [one.id, one]))
    // Each assignment counts against the next one's capacity, exactly as two
    // edges drawn one after the other would.
    const settled = [...canvas.edges]
    for (const edge of incomingEdges(canvas.edges, node.id)) {
      if (edge.slotField !== null) continue
      const source = byId.get(edge.sourceNodeId)
      // A text edge has no slot by design: it is a note in the prompt.
      if (!source || source.type === "text") continue
      const slotField = firstFreeSlot({
        slots,
        edges: settled,
        targetNodeId: node.id,
        kind: contributedKind(source),
      })
      if (!slotField) continue
      const at = settled.findIndex((one) => one.id === edge.id)
      if (at >= 0) settled[at] = { ...edge, slotField }
      updateEdgeMutate({ id: edge.id, slotField })
    }
  }, [canvas.edges, canvas.nodes, node.id, slots, updateEdgeMutate])

  const run = useCallback(() => {
    submitRun(({ batchId, generations }) => {
      updateNode.mutate({
        id: node.id,
        patch: {
          // The batch id is what finds every tile; the generation id is the
          // run the node *stands for* — the first sibling, which is what
          // gives the node a container to read from and a model to name
          // itself with even when the batch is several jobs.
          batchId,
          containerId,
          generationId: generations[0]?.id ?? null,
        },
      })
    })
  }, [containerId, node.id, submitRun, updateNode])

  /**
   * A promoted control, written into the draft — and, for the aspect ratio,
   * into the node itself.
   *
   * A generate node is a frame sized to its chosen ratio, so choosing `9:16`
   * has to make the frame tall before anything is run. Only the height moves:
   * the width is whatever the node is, so a node the user has resized keeps
   * the size they gave it. A value that is not a ratio at all — `auto`,
   * `match_input_image` — leaves the frame alone rather than guessing at one.
   */
  const aspectField =
    grid?.rows.find((row) => row.kind === "aspectRatio")?.field ?? null

  const setCommon = (field: string, value: string) => {
    updateDraft((current) => ({
      ...current,
      common: { ...current.common, [field]: value },
    }))
    if (field !== aspectField || parseAspectRatio(value) === null) return
    const height = frameSize(value, node.width).height
    if (height !== node.height) {
      updateNode.mutate({ id: node.id, patch: { height } })
    }
  }

  const setCount = (next: number) => {
    updateDraft((current) => ({
      ...current,
      count: Math.max(1, Math.min(maxCount, next)),
    }))
  }

  /**
   * The bar is a single row anchored to a node, so at narrow widths it has
   * nowhere to overflow to: wrapping pushes Run below the viewport and not
   * wrapping pushes it off the side. The count stepper and the cost badge are
   * the two controls that can be read and changed just as well from the
   * settings popover, so below the sidebar's own breakpoint that is where they
   * go — the prompt, the model and Run always stay on the bar itself.
   */
  const narrow = useIsMobile()

  const overflow = (
    <>
      <div
        data-testid="count-stepper"
        className="flex h-9 shrink-0 items-center gap-1 rounded-md border px-1"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="One fewer result"
          disabled={draft.count <= 1}
          onClick={() => setCount(draft.count - 1)}
        >
          <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" />
        </Button>
        <span
          data-testid="count-value"
          aria-label="Results"
          className="min-w-5 text-center font-mono text-sm tabular-nums"
        >
          {draft.count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="One more result"
          disabled={draft.count >= maxCount}
          onClick={() => setCount(draft.count + 1)}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
        </Button>
      </div>

      {/* Both slots are held open whether or not they have anything to say:
          the label appears the moment the count passes the model's own
          per-prediction maximum, and a slot that appears is a slot that
          shoves. */}
      {plan && plan.runs > 1 ? (
        <span
          data-testid="run-count"
          className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums"
        >
          {plan.runs} runs
        </span>
      ) : (
        <span aria-hidden className="w-12 shrink-0" />
      )}

      <span className="flex w-24 shrink-0 justify-end">
        <CostBadge quote={total} pending={cost.isFetching} />
      </span>
    </>
  )

  const advancedSchema =
    split && grid ? withoutIconGridFields(split.advanced, grid) : null
  const advancedCount = advancedSchema
    ? Object.keys(advancedSchema.properties).length
    : 0

  /*
   * The bar's width is **stated**, not inherited from its content. React Flow
   * anchors it to the node, so its width is its position: a model name
   * arriving, a cost resolving or an "N runs" label appearing would otherwise
   * slide every control sideways under the pointer. Every child that can
   * change its text is given a width for the same reason.
   */
  return (
    <div
      data-testid="canvas-prompt-bar"
      data-node-id={node.id}
      className="pointer-events-auto flex w-[min(52rem,calc(100vw-4rem))] flex-col gap-2 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">
          Compose · select references · review cost · run
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={updateNode.isPending}
          onClick={() => {
            updateNode.mutate(
              {
                id: node.id,
                patch: {
                  // A legacy draft stays legacy until the user rearranges
                  // something, so saving alone never pins its note order.
                  text: JSON.stringify(
                    promptRecipeSchema.parse({
                      ...draft,
                      blocks: draft.blocks ? blocks : undefined,
                    })
                  ),
                },
              },
              {
                onSuccess: () =>
                  setNotice("Prompt and settings saved to this project."),
                onError: (error) => setNotice(error.message),
              }
            )
          }}
        >
          Save prompt
        </Button>
      </div>
      {unknownCost && descriptor && !cost.isFetching && (
        <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <input
            type="checkbox"
            checked={acceptedUnknownCost}
            onChange={(event) => acceptUnknownCost(event.target.checked)}
          />
          I understand pricing is unavailable for this model. This run may incur
          charges; the provider determines the final cost.
        </label>
      )}
      {/* Wraps rather than overflowing: the bar is anchored to a node and a
          narrow window would otherwise push Run off the viewport. The messages
          are *below* this row — see the end of the bar. */}
      <div
        data-testid="prompt-bar-controls"
        className="flex flex-wrap items-end gap-2"
      >
        <CanvasReferenceStrip
          node={node}
          canvas={canvas}
          slots={descriptor?.referenceSlots ?? []}
          containerId={containerId}
          onNotice={setNotice}
          mentions={mentions.outcomes}
          galleryFor={galleryFor}
          onGalleryChange={setGalleryFor}
        />

        {/* ---- the prompt ------------------------------------------------
            The notes wired in and the user's own text blocks, in the order
            they are sent. Each text block is a real <textarea> so the
            @-mention picker has a caret to read. It takes `flex-1` inside a
            bar of stated width, so it absorbs the remaining space instead of
            setting it.
            ----------------------------------------------------------------- */}
        <PromptBlocks
          blocks={blocks}
          notesById={notesById}
          subjects={subjects}
          onEdit={editBlocks}
          onDisconnect={disconnectNote}
        />
        {/* ---- end of the prompt ----------------------------------------- */}

        {/*
          The ✨ menu, in the same place the creation bar kept it: between the
          prompt and the model. It is absent entirely when no local CLI was
          detected, so the "AI helpers" settings tab and this are one feature.
        */}
        <HelperMenu
          tools={aiTools.data}
          helpers={["improve-prompt", "suggest-shots"]}
          disabled={ai.state === "running"}
          onRun={(helper, tool) => {
            setNotice(null)
            if (helper === "improve-prompt") {
              if (!draft.prompt.trim()) {
                setNotice(
                  "Write a rough prompt first — the helper improves what is there."
                )
                return
              }
              ai.run(
                {
                  helper: "improve-prompt",
                  prompt: draft.prompt,
                  modelName: descriptor?.name ?? null,
                },
                tool
              )
              return
            }
            ai.run(
              {
                helper: "suggest-shots",
                containerName: container?.name?.trim() || "this sequence",
                notes: draft.prompt.trim() || null,
              },
              tool
            )
          }}
        />

        <ModelPicker
          value={draft.modelKey}
          onChange={(key) =>
            updateDraft((current) => ({ ...current, modelKey: key }))
          }
          kinds={kinds}
          // Stated so the model's own name cannot move its neighbours.
          className="w-44 shrink-0"
          // The canvas can show several bars over its lifetime; the palette
          // chord belongs to the window, not to whichever one is mounted.
          hotkeys={false}
          placeholder="Model"
        />

        {grid || narrow ? (
          <SettingsPopover
            grid={grid ?? EMPTY_GRID}
            values={draft.common}
            onChange={setCommon}
            footer={
              narrow ? (
                <div className="flex flex-wrap items-center gap-2">
                  {overflow}
                </div>
              ) : null
            }
          />
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          disabled={!advancedSchema}
          onClick={() => setAdvancedOpen(true)}
          className="w-28 shrink-0 justify-start text-muted-foreground"
        >
          <HugeiconsIcon icon={SlidersHorizontalIcon} className="size-3.5" />
          Advanced
          {advancedCount > 0 ? (
            <span className="font-mono text-xs tabular-nums">
              {advancedCount}
            </span>
          ) : null}
        </Button>

        {/* Below the sidebar's own breakpoint these three live in the
            settings popover instead — see `overflow` above. */}
        {narrow ? null : overflow}

        <Tooltip>
          <TooltipTrigger
            render={<span className="inline-flex" data-testid="run-wrapper" />}
          >
            <Button onClick={run} disabled={!canRun}>
              {submission.isPending ? "Queueing…" : "Run"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {disabledReason ?? "Queues the run — nothing else does."}
          </TooltipContent>
        </Tooltip>
      </div>

      {/*
        The messages, *below* the controls — first what the prompt's mentions
        will be (the downgrades, and the handles nobody claims), then the
        notice, the failure and the block.

        The toolbar anchors this bar by its top edge, so anything rendered
        above the row moves every control down the instant it appears — a
        notice arriving while the pointer is travelling to Run. Below the row
        the bar grows downward into empty canvas and nothing the user is
        aiming at moves. `role` is unchanged: the same text, still announced.
      */}
      <MentionNotes mentions={mentions.outcomes} />

      {notice ? (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {submission.error ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {submission.error.message}
        </p>
      ) : null}

      {blockedReason ? (
        <p
          role="alert"
          data-testid="run-blocked"
          className="px-1 text-xs text-destructive"
        >
          {blockedReason}
        </p>
      ) : null}

      {/*
        The AI answer, and the only place it can become the prompt: Apply
        replaces the prompt for an improved one, Insert appends a single
        suggested shot. Nothing is written into the bar without one of those.
      */}
      <HelperResultDialog
        controller={ai}
        onApply={
          ai.helper === "improve-prompt"
            ? (text) => editBlocks((current) => replaceText(current, text))
            : undefined
        }
        applyLabel="Use this prompt"
        onInsertShot={appendToPrompt}
      />

      {advancedSchema && descriptor ? (
        <AdvancedParams
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          modelName={descriptor.name}
          schema={advancedSchema}
          values={draft.advanced}
          onChange={(values) =>
            updateDraft((current) => ({ ...current, advanced: values }))
          }
          request={request}
        />
      ) : null}
    </div>
  )
}
