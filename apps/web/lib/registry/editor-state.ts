/**
 * The mapping editor's state (plan Task 9), as a pure reducer so every rule
 * the editor keeps is testable without a DOM.
 *
 * A draft is a family (name, id, kind, description) and its endpoints. Each
 * endpoint, once its provider schema has loaded (a free `models:get`), is one
 * row per schema field, and each row says what the field is in the family:
 * an input with a role, a canonical control, or nothing (Advanced).
 *
 * Rules kept here:
 * - Rows are pre-filled from `suggestEndpointMapping`, or from the mapping
 *   being edited, and remember that pre-fill as their `baseline`.
 *   Suggestions never overwrite a row the person changed (`touched`).
 * - Slot keys are assigned, not typed: a second `reference` becomes
 *   `reference:2`, and removing the first renumbers the rest in order.
 * - A control belongs to one row; choosing it elsewhere moves it.
 * - Nothing is lost while a schema loads (or fails to): the endpoint's
 *   mapping as given is what `toFamily` writes until rows replace it, and a
 *   mapped field the schema no longer has stays as a row, flagged, so it can
 *   be fixed rather than silently dropped.
 *
 * Validation is the contract's own (`validateFamily`,
 * `checkEndpointAgainstSchema`) — the same checks main runs on save — with
 * each issue addressed to the row it is about.
 *
 * ⛔ Pure. Never fetches; the component loads descriptors and dispatches.
 */
import {
  CONTROL_NAMES,
  REFERENCE_ROLES,
  checkEndpointAgainstSchema,
  providerIdSchema,
  slotKeyPosition,
  slotKeyRole,
  suggestEndpointMapping,
  validateFamily,
  type ControlName,
  type MappingControl,
  type MappingEndpoint,
  type MappingInput,
  type ModelDescriptor,
  type ModelFamily,
  type ProviderId,
  type ReferenceRole,
  type SuggestionConfidence,
} from "@opendirect/contract"

type Json = Record<string, unknown>

export type FamilyKind = ModelFamily["kind"]
export type ControlValues = NonNullable<MappingControl["values"]>

export type RowTarget =
  | { kind: "advanced" }
  | { kind: "input"; key: string; input: MappingInput }
  | { kind: "control"; control: ControlName; values?: ControlValues }

export interface RowSuggestion {
  target: RowTarget
  confidence: SuggestionConfidence
  why: string
}

export interface FieldRow {
  field: string
  /** The property's JSON Schema (type, enum, format, description). */
  schema: Json
  /** A URL string, or a list of them: the fields that can be inputs. */
  isUri: boolean
  isArray: boolean
  /** The provider requires this field. */
  required: boolean
  /** Mapped, but the endpoint's schema has no such field. */
  missing: boolean
  /** The media kind and bound the schema suggests, for a new input. */
  guess: { kind: MappingInput["kind"]; max: number | null } | null
  target: RowTarget
  /** What the row was pre-filled with; Reset goes back to it. */
  baseline: RowTarget
  suggestion: RowSuggestion | null
  /** The person changed it; suggestions never overwrite it. */
  touched: boolean
}

export interface EditorEndpoint {
  /** Stable across moves, for React keys. */
  uid: string
  provider: ProviderId
  model: string
  /** One row per schema property (in x-order), once the schema has loaded. */
  rows: FieldRow[]
  /** The endpoint's input schema; null until it loads. */
  inputSchema: Json | null
  loading: boolean
  error: string | null
  /** The mapping as given (edit, duplicate, import); used until rows exist. */
  mapping: MappingEndpoint | null
  /** Where the rows' pre-fill came from, for the banner. */
  prefill: "mapping" | "suggestions" | null
  /** The schema came from OpenRouter's capability manifest. */
  manifest: boolean
}

export interface EditorState {
  id: string
  name: string
  kind: FamilyKind
  description: string
  /** Kept when the source file had one. */
  schemaRef: string | null
  /** The id follows the name until the person edits it. */
  idTouched: boolean
  endpoints: EditorEndpoint[]
  /** The endpoint tab in view. */
  active: number
  /** The stored mapping being edited; a save replaces it. */
  replaceId: string | null
  /** Ids an auto-slug must not land on (the user's other mappings). */
  takenIds: string[]
  nextUid: number
}

export type EditorAction =
  | { type: "setName"; name: string }
  | { type: "setId"; id: string }
  | { type: "setKind"; kind: FamilyKind }
  | { type: "setDescription"; description: string }
  | { type: "addEndpoint"; provider: ProviderId; model: string }
  | {
      type: "endpointLoaded"
      index: number
      descriptor: ModelDescriptor
      /** A mapping to pre-fill from instead of the suggestions. */
      existing?: MappingEndpoint
    }
  | { type: "endpointFailed"; index: number; message: string }
  | { type: "setTarget"; index: number; field: string; target: RowTarget }
  | { type: "applySuggestion"; index: number; field: string }
  | { type: "applyAllSuggestions"; index: number }
  | { type: "resetEndpoint"; index: number }
  | { type: "removeEndpoint"; index: number }
  | { type: "moveEndpoint"; index: number; to: number }
  | { type: "setActive"; index: number }

const FAMILY_KINDS: readonly FamilyKind[] = ["video", "image", "audio"]
const ID_MAX = 64
/** A new input's key before renumbering puts it after its role's others. */
const LAST_POSITION = 99

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** "Kling 3 Pro" → "kling-3-pro": a valid family id, or "" for nothing. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ID_MAX)
    .replace(/-+$/g, "")
}

/**
 * `base`, or `base-2`, `base-3`… — the first not in `taken`, always within
 * the 64-character id limit.
 */
export function freeId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, ID_MAX - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

export function emptyEditor(
  options: { takenIds?: readonly string[] } = {}
): EditorState {
  return {
    id: "",
    name: "",
    kind: "video",
    description: "",
    schemaRef: null,
    idTouched: false,
    endpoints: [],
    active: 0,
    replaceId: null,
    takenIds: [...(options.takenIds ?? [])],
    nextUid: 1,
  }
}

function newEndpoint(
  uid: number,
  provider: ProviderId,
  model: string,
  mapping: MappingEndpoint | null
): EditorEndpoint {
  return {
    uid: `e${uid}`,
    provider,
    model,
    rows: [],
    inputSchema: null,
    loading: true,
    error: null,
    mapping,
    prefill: null,
    manifest: false,
  }
}

/** A draft from a valid family: every endpoint waits for its schema. */
export function fromFamily(
  family: ModelFamily,
  replaceId: string | null,
  options: { takenIds?: readonly string[] } = {}
): EditorState {
  const base = emptyEditor(options)
  const endpoints = family.endpoints.map((endpoint, index) =>
    newEndpoint(index + 1, endpoint.provider, endpoint.model, {
      provider: endpoint.provider,
      model: endpoint.model,
      inputs: structuredClone(endpoint.inputs ?? {}),
      controls: structuredClone(endpoint.controls ?? {}),
    })
  )
  return {
    ...base,
    id: family.id,
    name: family.name,
    kind: family.kind,
    description: family.description ?? "",
    schemaRef: family.$schema ?? null,
    idTouched: true,
    endpoints,
    replaceId,
    nextUid: endpoints.length + 1,
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Whatever of a raw input entry has the right types. */
function looseInput(raw: unknown): MappingInput | null {
  if (!isObject(raw)) return null
  const kinds: MappingInput["kind"][] = ["image", "video", "audio", "any"]
  const kind = kinds.find((k) => k === raw.kind) ?? "any"
  const input: MappingInput = { field: str(raw.field) ?? "", kind }
  if (typeof raw.required === "boolean") input.required = raw.required
  if (typeof raw.max === "number") input.max = raw.max
  if (str(raw.label) !== undefined) input.label = str(raw.label)
  if (str(raw.shape) !== undefined) input.shape = str(raw.shape)
  return input
}

function looseControl(raw: unknown): MappingControl | null {
  if (!isObject(raw)) return null
  const control: MappingControl = { field: str(raw.field) ?? "" }
  if (isObject(raw.values)) {
    const values: ControlValues = {}
    for (const [key, value] of Object.entries(raw.values)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        values[key] = value
      }
    }
    control.values = values
  }
  return control
}

/**
 * A draft from JSON that may not validate (Fix, or an invalid import): what
 * has the right shape is kept, so the person fixes it instead of retyping;
 * validation then says what is still wrong.
 */
export function fromRaw(
  raw: unknown,
  replaceId: string | null = null,
  options: { takenIds?: readonly string[] } = {}
): EditorState {
  const source = isObject(raw) ? raw : {}
  const endpoints: EditorEndpoint[] = []
  const list = Array.isArray(source.endpoints) ? source.endpoints : []
  for (const item of list) {
    if (!isObject(item)) continue
    const provider = providerIdSchema.safeParse(item.provider)
    const model = str(item.model) ?? ""
    const inputs: Record<string, MappingInput> = {}
    if (isObject(item.inputs)) {
      for (const [key, value] of Object.entries(item.inputs)) {
        const input = looseInput(value)
        if (input) inputs[key] = input
      }
    }
    const controls: Partial<Record<ControlName, MappingControl>> = {}
    if (isObject(item.controls)) {
      for (const name of CONTROL_NAMES) {
        const control = looseControl(item.controls[name])
        if (control) controls[name] = control
      }
    }
    const providerId: ProviderId = provider.success
      ? provider.data
      : "replicate"
    const endpoint = newEndpoint(endpoints.length + 1, providerId, model, {
      provider: providerId,
      model,
      inputs,
      controls,
    })
    if (!provider.success) {
      endpoint.loading = false
      endpoint.error = `"${String(item.provider)}" is not a provider this app knows.`
    }
    endpoints.push(endpoint)
  }
  const kind = FAMILY_KINDS.find((k) => k === source.kind) ?? "video"
  return {
    ...emptyEditor(options),
    id: str(source.id) ?? "",
    name: str(source.name) ?? "",
    kind,
    description: str(source.description) ?? "",
    schemaRef: str(source.$schema) ?? null,
    idTouched: str(source.id) !== undefined,
    endpoints,
    replaceId,
    nextUid: endpoints.length + 1,
  }
}

// ---------------------------------------------------------------------------
// Rows

function isUriString(schema: unknown): boolean {
  return isObject(schema) && schema.type === "string" && schema.format === "uri"
}

/** Properties in `x-order`, then in the order the schema lists them. */
function orderedProperties(schema: Json): Array<[string, Json]> {
  const properties = isObject(schema.properties) ? schema.properties : {}
  return Object.entries(properties)
    .filter((entry): entry is [string, Json] => isObject(entry[1]))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ao = a.entry[1]["x-order"]
      const bo = b.entry[1]["x-order"]
      const ax = typeof ao === "number" ? ao : Number.POSITIVE_INFINITY
      const bx = typeof bo === "number" ? bo : Number.POSITIVE_INFINITY
      return ax - bx || a.index - b.index
    })
    .map(({ entry }) => entry)
}

/** What a mapping says one field is. */
function targetFromMapping(
  mapping: MappingEndpoint,
  field: string
): RowTarget | null {
  for (const [key, input] of Object.entries(mapping.inputs)) {
    if (input.field === field) {
      return { kind: "input", key, input: { ...input } }
    }
  }
  for (const name of CONTROL_NAMES) {
    const control = mapping.controls[name]
    if (control?.field === field) {
      return control.values === undefined
        ? { kind: "control", control: name }
        : { kind: "control", control: name, values: { ...control.values } }
    }
  }
  return null
}

/** Fields a mapping names, in inputs-then-controls order. */
function mappedFields(mapping: MappingEndpoint): string[] {
  return [
    ...Object.values(mapping.inputs).map((input) => input.field),
    ...CONTROL_NAMES.flatMap((name) => {
      const control = mapping.controls[name]
      return control ? [control.field] : []
    }),
  ]
}

function buildRows(
  descriptor: ModelDescriptor,
  existing: MappingEndpoint | null
): FieldRow[] {
  const schema = descriptor.inputSchema
  const required = Array.isArray(schema.required) ? schema.required : []
  const suggested = suggestEndpointMapping(descriptor)
  const why = new Map(suggested.fields.map((f) => [f.field, f]))
  const slots = new Map(descriptor.referenceSlots.map((s) => [s.field, s]))

  const rows: FieldRow[] = orderedProperties(schema).map(([field, prop]) => {
    const suggestionTarget = targetFromMapping(suggested.endpoint, field) ?? {
      kind: "advanced" as const,
    }
    const reason = why.get(field)
    const baseline = existing
      ? (targetFromMapping(existing, field) ?? { kind: "advanced" as const })
      : suggestionTarget
    const slot = slots.get(field)
    const isArray = prop.type === "array"
    return {
      field,
      schema: prop,
      isUri: isUriString(prop) || (isArray && isUriString(prop.items)),
      isArray,
      required: required.includes(field),
      missing: false,
      guess: slot ? { kind: slot.kind, max: slot.max } : null,
      target: baseline,
      baseline,
      suggestion: reason
        ? {
            target: suggestionTarget,
            confidence: reason.confidence,
            why: reason.why,
          }
        : null,
      touched: false,
    }
  })

  // A mapped field the schema does not have stays visible, to be fixed.
  if (existing) {
    const present = new Set(rows.map((row) => row.field))
    for (const field of mappedFields(existing)) {
      if (present.has(field)) continue
      present.add(field)
      const target = targetFromMapping(existing, field)!
      rows.push({
        field,
        schema: {},
        isUri: false,
        isArray: false,
        required: false,
        missing: true,
        guess: null,
        target,
        baseline: target,
        suggestion: null,
        touched: false,
      })
    }
  }
  return rows
}

/**
 * Slot keys per role, densely numbered in their current order: a new input
 * (position 99) goes after its role's others, and a gap closes up.
 */
function renumber(rows: FieldRow[]): FieldRow[] {
  const byRole = new Map<ReferenceRole, number[]>()
  rows.forEach((row, index) => {
    if (row.target.kind !== "input") return
    const role = slotKeyRole(row.target.key)
    byRole.set(role, [...(byRole.get(role) ?? []), index])
  })
  const keys = new Map<number, string>()
  for (const [role, indexes] of byRole) {
    const position = (i: number) => {
      const target = rows[i]!.target
      return target.kind === "input" ? slotKeyPosition(target.key) : 0
    }
    ;[...indexes]
      .sort((a, b) => position(a) - position(b) || a - b)
      .forEach((rowIndex, order) => {
        keys.set(rowIndex, order === 0 ? role : `${role}:${order + 1}`)
      })
  }
  return rows.map((row, index) => {
    const key = keys.get(index)
    if (row.target.kind !== "input" || key === undefined) return row
    if (row.target.key === key) return row
    return { ...row, target: { ...row.target, key } }
  })
}

/**
 * Sets one row's target: a control leaves any other row that had it, and a
 * role new to this row goes after the role's other inputs.
 */
function assign(
  rows: FieldRow[],
  field: string,
  target: RowTarget,
  touched: boolean
): FieldRow[] {
  const next = rows.map((row) => {
    if (row.field === field) {
      let placed = target
      if (target.kind === "input") {
        const role = slotKeyRole(target.key)
        const previous = row.target
        const key =
          previous.kind === "input" && slotKeyRole(previous.key) === role
            ? previous.key
            : `${role}:${LAST_POSITION}`
        placed = { ...target, key, input: { ...target.input, field } }
      }
      return { ...row, target: placed, touched }
    }
    if (
      target.kind === "control" &&
      row.target.kind === "control" &&
      row.target.control === target.control
    ) {
      return { ...row, target: { kind: "advanced" as const }, touched: true }
    }
    return row
  })
  return renumber(next)
}

function updateEndpoint(
  state: EditorState,
  index: number,
  update: (endpoint: EditorEndpoint) => EditorEndpoint
): EditorState {
  const endpoint = state.endpoints[index]
  if (!endpoint) return state
  const endpoints = [...state.endpoints]
  endpoints[index] = update(endpoint)
  return { ...state, endpoints }
}

function autoId(state: EditorState, name: string): string {
  const base = slugify(name)
  if (!base) return ""
  const taken = state.takenIds.filter((id) => id !== state.replaceId)
  return freeId(base, taken)
}

export function editorReducer(
  state: EditorState,
  action: EditorAction
): EditorState {
  switch (action.type) {
    case "setName":
      return {
        ...state,
        name: action.name,
        id: state.idTouched ? state.id : autoId(state, action.name),
      }
    case "setId":
      return action.id === ""
        ? { ...state, id: autoId(state, state.name), idTouched: false }
        : { ...state, id: action.id, idTouched: true }
    case "setKind":
      return { ...state, kind: action.kind }
    case "setDescription":
      return { ...state, description: action.description }
    case "setActive":
      return action.index >= 0 && action.index < state.endpoints.length
        ? { ...state, active: action.index }
        : state

    case "addEndpoint": {
      const at = state.endpoints.findIndex(
        (e) => e.provider === action.provider && e.model === action.model
      )
      if (at !== -1) return { ...state, active: at }
      return {
        ...state,
        endpoints: [
          ...state.endpoints,
          newEndpoint(state.nextUid, action.provider, action.model, null),
        ],
        active: state.endpoints.length,
        nextUid: state.nextUid + 1,
      }
    }

    case "endpointLoaded": {
      const endpoint = state.endpoints[action.index]
      const { descriptor } = action
      if (
        !endpoint ||
        !endpoint.loading ||
        endpoint.provider !== descriptor.provider ||
        endpoint.model !== descriptor.slug
      ) {
        return state
      }
      const existing = action.existing ?? endpoint.mapping
      const next = updateEndpoint(state, action.index, (e) => ({
        ...e,
        rows: buildRows(descriptor, existing),
        inputSchema: descriptor.inputSchema,
        loading: false,
        error: null,
        prefill: existing ? "mapping" : "suggestions",
        manifest:
          descriptor.inputSchema["x-opendirect-source"] ===
          "openrouter-capabilities",
      }))
      // An unnamed draft takes the first model's name and kind.
      if (state.name.trim() === "" && !state.idTouched) {
        const kind = FAMILY_KINDS.find((k) => k === descriptor.kind)
        return {
          ...next,
          name: descriptor.name.slice(0, 80),
          id: autoId(next, descriptor.name),
          kind: kind ?? next.kind,
        }
      }
      return next
    }

    case "endpointFailed":
      return updateEndpoint(state, action.index, (e) =>
        e.loading ? { ...e, loading: false, error: action.message } : e
      )

    case "setTarget":
      return updateEndpoint(state, action.index, (e) => ({
        ...e,
        rows: assign(e.rows, action.field, action.target, true),
      }))

    case "applySuggestion":
      return updateEndpoint(state, action.index, (e) => {
        const row = e.rows.find((r) => r.field === action.field)
        if (!row?.suggestion) return e
        return {
          ...e,
          rows: assign(e.rows, row.field, row.suggestion.target, false),
        }
      })

    case "applyAllSuggestions":
      return updateEndpoint(state, action.index, (e) => {
        const kept = new Set(
          e.rows.flatMap((row) =>
            row.touched && row.target.kind === "control"
              ? [row.target.control]
              : []
          )
        )
        const rows = e.rows.map((row) => {
          if (row.touched || !row.suggestion) return row
          const target = row.suggestion.target
          if (target.kind === "control" && kept.has(target.control)) {
            return { ...row, target: { kind: "advanced" as const } }
          }
          return { ...row, target }
        })
        return { ...e, rows: renumber(rows) }
      })

    case "resetEndpoint":
      return updateEndpoint(state, action.index, (e) => ({
        ...e,
        rows: e.rows.map((row) => ({
          ...row,
          target: row.baseline,
          touched: false,
        })),
      }))

    case "removeEndpoint": {
      if (!state.endpoints[action.index]) return state
      const endpoints = state.endpoints.filter((_, i) => i !== action.index)
      const active =
        state.active > action.index
          ? state.active - 1
          : Math.min(state.active, Math.max(0, endpoints.length - 1))
      return { ...state, endpoints, active }
    }

    case "moveEndpoint": {
      const { index, to } = action
      if (
        !state.endpoints[index] ||
        to < 0 ||
        to >= state.endpoints.length ||
        to === index
      ) {
        return state
      }
      const endpoints = [...state.endpoints]
      const [moved] = endpoints.splice(index, 1)
      endpoints.splice(to, 0, moved!)
      const activeUid = state.endpoints[state.active]?.uid
      const active = Math.max(
        0,
        endpoints.findIndex((e) => e.uid === activeUid)
      )
      return { ...state, endpoints, active }
    }
  }
}

// ---------------------------------------------------------------------------
// Output

function cleanInput(input: MappingInput, field: string): MappingInput {
  const out: MappingInput = { field, kind: input.kind }
  if (input.required !== undefined) out.required = input.required
  if (input.max !== undefined) out.max = input.max
  if (input.label !== undefined && input.label !== "") out.label = input.label
  if (input.shape !== undefined && input.shape !== "") out.shape = input.shape
  return out
}

/** One endpoint as mapping JSON: from its rows, or as given until they load. */
export function endpointMapping(endpoint: EditorEndpoint): MappingEndpoint {
  if (endpoint.inputSchema === null) {
    return endpoint.mapping
      ? structuredClone(endpoint.mapping)
      : {
          provider: endpoint.provider,
          model: endpoint.model,
          inputs: {},
          controls: {},
        }
  }
  const inputs: Record<string, MappingInput> = {}
  const controls: Partial<Record<ControlName, MappingControl>> = {}
  for (const row of endpoint.rows) {
    const { target } = row
    if (target.kind === "input") {
      inputs[target.key] = cleanInput(target.input, row.field)
    } else if (target.kind === "control") {
      controls[target.control] =
        target.values === undefined
          ? { field: row.field }
          : { field: row.field, values: { ...target.values } }
    }
  }
  return {
    provider: endpoint.provider,
    model: endpoint.model,
    inputs,
    controls,
  }
}

/**
 * The draft as family JSON — typed as a family, but it may not validate;
 * `validateEditor` says why.
 */
export function toFamily(state: EditorState): ModelFamily {
  const family: ModelFamily = {
    ...(state.schemaRef !== null ? { $schema: state.schemaRef } : {}),
    id: state.id,
    name: state.name,
    kind: state.kind,
    endpoints: state.endpoints.map(endpointMapping),
  }
  if (state.description.trim() !== "") family.description = state.description
  return family
}

export interface EditorIssue {
  /** The family's own fields, or an endpoint (and the row it is about). */
  where: "family" | { endpoint: number; field?: string }
  /** Dotted, into the family: `id`, `endpoints.0.inputs.character.max`. */
  path: string
  message: string
}

/** The row a mapping key (`inputs.<key>` / `controls.<name>`) belongs to. */
function fieldFor(
  endpoint: EditorEndpoint | undefined,
  section: string,
  key: string
): string | undefined {
  if (!endpoint) return undefined
  const mapping = endpointMapping(endpoint)
  if (section === "inputs") return mapping.inputs[key]?.field
  if (section === "controls") {
    return (CONTROL_NAMES as readonly string[]).includes(key)
      ? mapping.controls[key as ControlName]?.field
      : undefined
  }
  return undefined
}

/** Where an issue at `path` (dotted, into the family) belongs in the editor. */
export function locateIssue(
  state: EditorState,
  path: string
): EditorIssue["where"] {
  const parts = path.split(".")
  if (parts[0] !== "endpoints" || parts.length < 2) return "family"
  const index = Number(parts[1])
  if (!Number.isInteger(index)) return "family"
  const section = parts[2]
  const key = parts[3]
  const field =
    section !== undefined && key !== undefined
      ? fieldFor(state.endpoints[index], section, key)
      : undefined
  return field === undefined ? { endpoint: index } : { endpoint: index, field }
}

/**
 * Every problem with the draft: the family schema's (what main checks on
 * save) and each loaded endpoint's fit with its provider schema, addressed
 * to the row it is about.
 */
export function validateEditor(state: EditorState): EditorIssue[] {
  const family = toFamily(state)
  const issues: Array<{ path: string; message: string }> = [
    ...validateFamily(family).issues,
  ]
  state.endpoints.forEach((endpoint, index) => {
    if (endpoint.inputSchema === null) return
    for (const issue of checkEndpointAgainstSchema(
      family.endpoints[index]!,
      endpoint.inputSchema
    )) {
      issues.push({
        path: `endpoints.${index}.${issue.path}`,
        message: issue.message,
      })
    }
  })
  const seen = new Set<string>()
  return issues.flatMap((issue) => {
    const id = `${issue.path}\u0000${issue.message}`
    if (seen.has(id)) return []
    seen.add(id)
    return [
      {
        path: issue.path,
        message: plainMessage(issue.path, issue.message),
        where: locateIssue(state, issue.path),
      },
    ]
  })
}

/**
 * zod's generic wording for the few limits a person hits while typing,
 * said as what to do. Every other message is already a sentence.
 */
function plainMessage(path: string, message: string): string {
  if (!message.startsWith("Too small") && !message.startsWith("Too big")) {
    return message
  }
  if (path === "name") {
    return message.startsWith("Too small")
      ? "Give the mapping a name."
      : "Keep the name to 80 characters."
  }
  if (path === "description") return "Keep the description to 500 characters."
  if (path === "endpoints") return "Add at least one endpoint."
  if (path.endsWith(".max")) return "Max must be 1 or more."
  if (path.endsWith(".label")) {
    return message.startsWith("Too small")
      ? "A label cannot be empty."
      : "Keep the label to 80 characters."
  }
  return message
}

/** The role picker's order: the design table's. */
export const ROLE_ORDER: readonly ReferenceRole[] = REFERENCE_ROLES

/** Same meaning (ignoring slot numbering): is the row as suggested? */
export function sameTarget(a: RowTarget, b: RowTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "input" && b.kind === "input") {
    return (
      slotKeyRole(a.key) === slotKeyRole(b.key) &&
      JSON.stringify(cleanInput(a.input, "")) ===
        JSON.stringify(cleanInput(b.input, ""))
    )
  }
  if (a.kind === "control" && b.kind === "control") {
    return (
      a.control === b.control &&
      JSON.stringify(a.values ?? null) === JSON.stringify(b.values ?? null)
    )
  }
  return true
}
