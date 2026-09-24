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
  formatFamilyJson,
  providerIdSchema,
  slotKeySchema,
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
  /** What the loaded model makes (`video`, `image`…); null until it loads. */
  modelKind: string | null
  /**
   * A provider this app does not know, as the file spelled it. The endpoint
   * keeps it (and fails validation) rather than being read as another one.
   */
  rawProvider: string | null
}

/**
 * Something reading a stored or imported mapping had to change or leave
 * out. A blocking one is a validation issue until the person settles it
 * (by choosing the row's target, or the family's kind); the rest are notes.
 */
export interface Repair {
  /** The endpoint's `uid`; null for the family itself. */
  endpoint: string | null
  /** The row's field, or the family field (`kind`); null for the endpoint. */
  field: string | null
  message: string
  blocking: boolean
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
  repairs: Repair[]
  /**
   * The draft as opened (plus what loading schemas filled in): the draft is
   * dirty exactly when it differs from this.
   */
  baseline: ModelFamily | null
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
  | { type: "retryEndpoint"; index: number }
  | { type: "changeEndpointModel"; index: number; model: string }
  | { type: "restoreRows"; uid: string; rows: FieldRow[] }
  | { type: "setTakenIds"; ids: readonly string[] }
  /** The draft was stored: it is what `replaceId` names now, and clean. */
  | { type: "saved" }

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
    repairs: [],
    baseline: null,
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
    modelKind: null,
    rawProvider: null,
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
  return withBaseline({
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
  })
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
  const repairs: Repair[] = []
  const list = Array.isArray(source.endpoints) ? source.endpoints : []
  for (const item of list) {
    if (!isObject(item)) continue
    const uid = `e${endpoints.length + 1}`
    const provider = providerIdSchema.safeParse(item.provider)
    const model = str(item.model) ?? ""
    const inputs: Record<string, MappingInput> = {}
    if (isObject(item.inputs)) {
      const entries = Object.entries(item.inputs)
      // Valid keys first, so a renamed one numbers after them.
      for (const [key, value] of entries) {
        if (!slotKeySchema.safeParse(key).success) continue
        const input = looseInput(value)
        if (input) inputs[key] = input
        else {
          repairs.push({
            endpoint: uid,
            field: null,
            message: `Input "${key}" could not be read and was left out.`,
            blocking: false,
          })
        }
      }
      for (const [key, value] of entries) {
        if (slotKeySchema.safeParse(key).success) continue
        const input = looseInput(value)
        if (!input) continue
        const taken = Object.keys(inputs).filter(
          (k) => slotKeyRole(k) === "reference"
        ).length
        const renamed = taken === 0 ? "reference" : `reference:${taken + 1}`
        inputs[renamed] = input
        repairs.push({
          endpoint: uid,
          field: input.field,
          message: `"${key}" is not a role, so this input was read as Reference. Choose the role it should have (Reference when unsure).`,
          blocking: true,
        })
      }
    }
    const controls: Partial<Record<ControlName, MappingControl>> = {}
    if (isObject(item.controls)) {
      for (const [name, value] of Object.entries(item.controls)) {
        const control = looseControl(value)
        if (!(CONTROL_NAMES as readonly string[]).includes(name)) {
          repairs.push({
            endpoint: uid,
            field: control?.field ?? null,
            message: `"${name}" is not a control this app knows, so ${control?.field ? `"${control.field}"` : "its field"} stays under Advanced.`,
            blocking: false,
          })
          continue
        }
        if (control) controls[name as ControlName] = control
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
      endpoint.rawProvider = String(item.provider)
      endpoint.error = `"${String(item.provider)}" is not a provider this app knows. Remove this endpoint, or add it again on a provider the app has.`
    }
    endpoints.push(endpoint)
  }
  const knownKind = FAMILY_KINDS.find((k) => k === source.kind)
  if (knownKind === undefined) {
    repairs.push({
      endpoint: null,
      field: "kind",
      message:
        source.kind === undefined
          ? "The mapping has no kind. Choose Video, Image or Audio."
          : `"${String(source.kind)}" is not a kind. Choose Video, Image or Audio.`,
      blocking: true,
    })
  }
  const kind = knownKind ?? "video"
  return withBaseline({
    ...emptyEditor(options),
    repairs,
    id: str(source.id) ?? "",
    name: str(source.name) ?? "",
    kind,
    description: str(source.description) ?? "",
    schemaRef: str(source.$schema) ?? null,
    idTouched: str(source.id) !== undefined,
    endpoints,
    replaceId,
    nextUid: endpoints.length + 1,
  })
}

/** The draft with its current content as the baseline `isDirty` compares to. */
export function withBaseline(state: EditorState): EditorState {
  return { ...state, baseline: toFamily(state) }
}

/** Has the person changed the draft from what was opened? */
export function isDirty(state: EditorState): boolean {
  if (state.baseline === null) return false
  return formatFamilyJson(toFamily(state)) !== formatFamilyJson(state.baseline)
}

/** An endpoint's notes from reading the file: shown, never blocking. */
export function endpointNotices(state: EditorState, index: number): Repair[] {
  const uid = state.endpoints[index]?.uid
  return state.repairs.filter(
    (repair) => repair.endpoint === uid && !repair.blocking
  )
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

/**
 * The baseline after a schema load: what the load filled in (rows, and a
 * name taken from the model) is not the person's edit, so the baseline takes
 * it too — for an endpoint the baseline already had.
 */
function loadedBaseline(
  before: EditorState,
  after: EditorState,
  index: number
): ModelFamily | null {
  const baseline = before.baseline
  if (baseline === null) return null
  const endpoint = after.endpoints[index]!
  const out: ModelFamily = {
    ...baseline,
    endpoints: baseline.endpoints.map((e) =>
      e.provider === endpoint.provider && e.model === endpoint.model
        ? endpointMapping(endpoint)
        : e
    ),
  }
  if (baseline.name.trim() === "" && after.name !== before.name) {
    out.name = after.name
    out.id = after.id
    out.kind = after.kind
  }
  return out
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
      // Clearing the id hands it back to the name — from the next name
      // edit, so clearing a field to retype it is not fought.
      return action.id === ""
        ? { ...state, id: "", idTouched: false }
        : { ...state, id: action.id, idTouched: true }
    case "setKind":
      return {
        ...state,
        kind: action.kind,
        repairs: state.repairs.filter(
          (r) => !(r.endpoint === null && r.field === "kind")
        ),
      }
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
      // A late success after a failure still counts; a second one does not.
      if (
        !endpoint ||
        endpoint.inputSchema !== null ||
        endpoint.rawProvider !== null ||
        endpoint.provider !== descriptor.provider ||
        endpoint.model !== descriptor.slug
      ) {
        return state
      }
      const existing = action.existing ?? endpoint.mapping
      let next = updateEndpoint(state, action.index, (e) => ({
        ...e,
        rows: buildRows(descriptor, existing),
        inputSchema: descriptor.inputSchema,
        loading: false,
        error: null,
        prefill: existing ? "mapping" : "suggestions",
        manifest:
          descriptor.inputSchema["x-opendirect-source"] ===
          "openrouter-capabilities",
        modelKind: descriptor.kind,
      }))
      // An unnamed draft takes the first model's name and kind.
      if (state.name.trim() === "" && !state.idTouched) {
        const kind = FAMILY_KINDS.find((k) => k === descriptor.kind)
        next = {
          ...next,
          name: descriptor.name.slice(0, 80),
          id: autoId(next, descriptor.name),
          kind: kind ?? next.kind,
        }
      }
      return { ...next, baseline: loadedBaseline(state, next, action.index) }
    }

    case "retryEndpoint":
      return updateEndpoint(state, action.index, (e) =>
        e.rawProvider !== null || e.inputSchema !== null
          ? e
          : { ...e, loading: true, error: null }
      )

    case "changeEndpointModel": {
      const model = action.model.trim()
      const endpoint = state.endpoints[action.index]
      if (!endpoint || model === "" || endpoint.rawProvider !== null) {
        return state
      }
      return updateEndpoint(state, action.index, (e) => ({
        ...e,
        model,
        rows: [],
        inputSchema: null,
        loading: true,
        error: null,
        prefill: null,
        modelKind: null,
        mapping: e.mapping ? { ...e.mapping, model } : null,
      }))
    }

    case "restoreRows": {
      const index = state.endpoints.findIndex((e) => e.uid === action.uid)
      return updateEndpoint(state, index, (e) => ({ ...e, rows: action.rows }))
    }

    case "setTakenIds":
      return { ...state, takenIds: [...action.ids] }

    case "saved":
      return {
        ...state,
        replaceId: state.id,
        idTouched: true,
        baseline: toFamily(state),
      }

    case "endpointFailed":
      return updateEndpoint(state, action.index, (e) =>
        e.loading ? { ...e, loading: false, error: action.message } : e
      )

    case "setTarget": {
      const uid = state.endpoints[action.index]?.uid
      const next = updateEndpoint(state, action.index, (e) => ({
        ...e,
        rows: assign(e.rows, action.field, action.target, true),
      }))
      // Choosing the row's target settles what reading the file changed.
      return {
        ...next,
        repairs: state.repairs.filter(
          (r) => !(r.endpoint === uid && r.field === action.field)
        ),
      }
    }

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
      const uid = state.endpoints[action.index]!.uid
      const endpoints = state.endpoints.filter((_, i) => i !== action.index)
      const repairs = state.repairs.filter((r) => r.endpoint !== uid)
      const active =
        state.active > action.index
          ? state.active - 1
          : Math.min(state.active, Math.max(0, endpoints.length - 1))
      return { ...state, endpoints, active, repairs }
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
  // An unknown provider stays as spelled, so validation names it.
  const provider = (endpoint.rawProvider ?? endpoint.provider) as ProviderId
  if (endpoint.inputSchema === null) {
    return endpoint.mapping
      ? { ...structuredClone(endpoint.mapping), provider }
      : { provider, model: endpoint.model, inputs: {}, controls: {} }
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
  const extra: EditorIssue[] = []
  for (const repair of state.repairs) {
    if (!repair.blocking) continue
    if (repair.endpoint === null) {
      issues.push({ path: repair.field ?? "", message: repair.message })
      continue
    }
    const index = state.endpoints.findIndex((e) => e.uid === repair.endpoint)
    if (index === -1) continue
    extra.push({
      path: `endpoints.${index}.repair.${repair.field ?? ""}`,
      message: repair.message,
      where:
        repair.field === null
          ? { endpoint: index }
          : { endpoint: index, field: repair.field },
    })
  }
  state.endpoints.forEach((endpoint, index) => {
    const where = `${endpoint.provider}:${endpoint.model}`
    if (
      endpoint.modelKind !== null &&
      (FAMILY_KINDS as readonly string[]).includes(endpoint.modelKind) &&
      endpoint.modelKind !== state.kind
    ) {
      issues.push({
        path: `endpoints.${index}`,
        message: `${where} makes ${endpoint.modelKind}, but this mapping is ${state.kind}. Change the kind, or remove the endpoint.`,
      })
    }
    if (
      endpoint.inputSchema === null &&
      !endpoint.loading &&
      endpoint.rawProvider === null &&
      !mapsAnything(endpoint.mapping)
    ) {
      issues.push({
        path: `endpoints.${index}`,
        message: `The fields of ${where} didn't load, so it maps nothing yet. Retry, check the slug, or remove the endpoint.`,
      })
    }
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
  const located = issues.flatMap((issue) => {
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
  return [...located, ...extra]
}

function mapsAnything(mapping: MappingEndpoint | null): boolean {
  return (
    mapping !== null &&
    (Object.keys(mapping.inputs).length > 0 ||
      Object.values(mapping.controls).some((c) => c !== undefined))
  )
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

/**
 * The input a row becomes when a role is chosen for it: keeps what still
 * applies of its current input — kind, bound, shape, and required as the
 * person left it (off stays off) — and the label only while the role stays.
 * A row that was not an input starts from the schema's guess, required when
 * the provider requires the field.
 */
export function inputTarget(row: FieldRow, role: ReferenceRole): RowTarget {
  const current = row.target.kind === "input" ? row.target : null
  const input: MappingInput = {
    field: row.field,
    kind: current?.input.kind ?? row.guess?.kind ?? "any",
  }
  const required = current ? current.input.required === true : row.required
  if (required) input.required = true
  const max = current ? current.input.max : (row.guess?.max ?? undefined)
  if (row.isArray && max !== undefined) input.max = max
  if (current && slotKeyRole(current.key) === role && current.input.label) {
    input.label = current.input.label
  }
  if (current?.input.shape) input.shape = current.input.shape
  return { kind: "input", key: role, input }
}

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
