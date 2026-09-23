/**
 * How each role looks and reads in the UI (design §2,
 * docs/plans/2026-09-24-model-registry-design.md).
 *
 * One table so a role has the same icon, name and explanation wherever a
 * slot appears: the Models settings tab, the mapping editor, the model
 * picker's filters and the canvas slots. The map is typed exhaustively over
 * `ReferenceRole`, so adding a role to the contract fails the build here
 * until it has a look — and `role-meta.test.ts` checks the same at runtime.
 *
 * `label` is the contract's `ROLE_LABELS`, never a second spelling.
 * `description` answers the design's one question — what does this input
 * control in the output? — in the words of the design table.
 */
import {
  Attachment01Icon,
  AudioWave01Icon,
  DrawingCompassIcon,
  Edit02Icon,
  File01Icon,
  Image01Icon,
  LayerMaskIcon,
  MusicNote01Icon,
  NextIcon,
  PaintBoardIcon,
  PreviousIcon,
  UserIcon,
  Video01Icon,
  WorkoutRunIcon,
} from "@hugeicons/core-free-icons"
import {
  REFERENCE_ROLES,
  ROLE_LABELS,
  type ReferenceRole,
  type ReferenceSlot,
} from "@opendirect/contract"

/** The icon type `HugeiconsIcon` accepts. */
export type RoleIcon = typeof UserIcon

export interface RoleMeta {
  role: ReferenceRole
  /** The contract's label, e.g. "First frame". */
  label: string
  /** At most 8 characters, for tight chips. */
  short: string
  /** One sentence: what the input controls in the output. */
  description: string
  icon: RoleIcon
}

export const ROLE_META: Record<ReferenceRole, RoleMeta> = {
  source: {
    role: "source",
    label: ROLE_LABELS.source,
    short: "Source",
    description: "What to change: the image or video being edited.",
    icon: Edit02Icon,
  },
  mask: {
    role: "mask",
    label: ROLE_LABELS.mask,
    short: "Mask",
    description: "What to change: which region of the source to change.",
    icon: LayerMaskIcon,
  },
  first_frame: {
    role: "first_frame",
    label: ROLE_LABELS.first_frame,
    short: "Start",
    description: "When: the output starts on this frame.",
    icon: PreviousIcon,
  },
  last_frame: {
    role: "last_frame",
    label: ROLE_LABELS.last_frame,
    short: "End",
    description: "When: the output ends on this frame.",
    icon: NextIcon,
  },
  character: {
    role: "character",
    label: ROLE_LABELS.character,
    short: "Char",
    description:
      "What to keep: identity, such as a person, creature or product.",
    icon: UserIcon,
  },
  style: {
    role: "style",
    label: ROLE_LABELS.style,
    short: "Style",
    description: "What to keep: the look, palette and medium.",
    icon: PaintBoardIcon,
  },
  structure: {
    role: "structure",
    label: ROLE_LABELS.structure,
    short: "Struct",
    description: "What to keep: the layout, pose, depth or edges.",
    icon: DrawingCompassIcon,
  },
  motion: {
    role: "motion",
    label: ROLE_LABELS.motion,
    short: "Motion",
    description: "What to keep: how things move.",
    icon: WorkoutRunIcon,
  },
  soundtrack: {
    role: "soundtrack",
    label: ROLE_LABELS.soundtrack,
    short: "Sound",
    description: "What to keep: what the output sounds like or lip-syncs to.",
    icon: MusicNote01Icon,
  },
  reference: {
    role: "reference",
    label: ROLE_LABELS.reference,
    short: "Ref",
    description: "General context; the model decides how to use it.",
    icon: Attachment01Icon,
  },
}

/**
 * The meta for a role or a slot key (`reference:2` → reference). Anything
 * unrecognised reads as `reference`, the role that is never wrong.
 */
export function roleMeta(roleOrSlotKey: string): RoleMeta {
  const role = roleOrSlotKey.split(":")[0] as ReferenceRole
  return REFERENCE_ROLES.includes(role) ? ROLE_META[role] : ROLE_META.reference
}

export interface KindMeta {
  label: string
  icon: RoleIcon
}

/** The media kind a slot enforces, as a glyph beside the role. */
export const KIND_META: Record<ReferenceSlot["kind"], KindMeta> = {
  image: { label: "Image", icon: Image01Icon },
  video: { label: "Video", icon: Video01Icon },
  audio: { label: "Audio", icon: AudioWave01Icon },
  any: { label: "Any file", icon: File01Icon },
}
