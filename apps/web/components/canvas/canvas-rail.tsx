"use client"

/**
 * The left rail: five controls, and no sixth.
 *
 * Add, select, folder, undo, redo. Everything else a canvas could offer is
 * either on the node it belongs to or on the prompt bar under it, because a
 * toolbar that grows is a toolbar nobody reads.
 *
 * ⛔ Nothing on this rail spends money. Add creates an empty node; the folder
 * imports files from disk; undo and redo replay canvas operations only, which
 * is enforced by `use-canvas-history.ts` rather than trusted here.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cursor01Icon,
  FolderOpenIcon,
  Image01Icon,
  PlusSignIcon,
  RedoIcon,
  TextIcon,
  UndoIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import type { CanvasNodeType } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

/** What a plain drag on the surface does. */
export type CanvasMode = "pan" | "select"

export interface CanvasRailProps {
  mode: CanvasMode
  onModeChange: (mode: CanvasMode) => void
  /** Puts a new, empty node in the middle of the viewport. */
  onAdd: (type: CanvasNodeType) => void
  /** Opens the native file picker and imports what comes back as media nodes. */
  onImport: () => void
  importing: boolean
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

const ADD_CHOICES: {
  type: CanvasNodeType
  label: string
  icon: typeof TextIcon
}[] = [
  { type: "text", label: "Text", icon: TextIcon },
  { type: "image_gen", label: "Image gen", icon: Image01Icon },
  { type: "video_gen", label: "Video gen", icon: Video01Icon },
]

function RailButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof TextIcon
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant={active ? "secondary" : "ghost"}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className="size-8"
          />
        }
      >
        <HugeiconsIcon icon={icon} className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CanvasRail({
  mode,
  onModeChange,
  onAdd,
  onImport,
  importing,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
}: CanvasRailProps) {
  return (
    <div
      data-testid="canvas-rail"
      className={cn(
        "absolute top-3 left-3 z-10 flex flex-col gap-1 rounded-lg border bg-card p-1 shadow-sm"
      )}
    >
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Add a node"
              className="size-8"
            />
          }
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-40 p-1">
          {ADD_CHOICES.map((choice) => (
            <Button
              key={choice.type}
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onAdd(choice.type)}
            >
              <HugeiconsIcon icon={choice.icon} className="size-4" />
              {choice.label}
            </Button>
          ))}
        </PopoverContent>
      </Popover>

      <RailButton
        label={mode === "select" ? "Select mode" : "Pan mode"}
        icon={Cursor01Icon}
        active={mode === "select"}
        onClick={() => onModeChange(mode === "select" ? "pan" : "select")}
      />

      <RailButton
        label={importing ? "Importing…" : "Import files"}
        icon={FolderOpenIcon}
        disabled={importing}
        onClick={onImport}
      />

      <RailButton
        label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
        icon={UndoIcon}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <RailButton
        label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
        icon={RedoIcon}
        disabled={!canRedo}
        onClick={onRedo}
      />
    </div>
  )
}
