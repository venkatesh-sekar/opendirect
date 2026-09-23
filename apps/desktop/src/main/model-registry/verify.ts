/**
 * The pure half of `verify:providers --registry` (design §6): compare every
 * mapped endpoint with the schema the provider publishes today, so an
 * upstream rename shows up as a report rather than as a broken generation.
 *
 * It lives here rather than beside the script so the root vitest run covers
 * it. The fetcher is injected: the script passes the adapters' free
 * `getModel` reads, and the tests pass fixtures.
 *
 * ⛔ Nothing here makes a request. The script's fetcher may only ever `GET`.
 */
import {
  checkEndpointAgainstSchema,
  type ModelFamily,
  type ProviderId,
  type SchemaIssue,
} from "@opendirect/contract"

export type FetchSchemaResult =
  | { status: "ok"; inputSchema: unknown }
  /** No key for this provider, say. Reported, but not a failure. */
  | { status: "skipped"; reason: string }

/** The live input schema of `provider:model`. Throws when the read fails. */
export type FetchSchema = (
  provider: ProviderId,
  model: string
) => Promise<FetchSchemaResult>

export interface VerifyRow {
  familyId: string
  /** `provider:model` */
  endpoint: string
  status: "ok" | "issues" | "skipped" | "error"
  issues: SchemaIssue[]
  /** The skip reason or the error message. */
  note: string | null
}

export interface VerifyReport {
  rows: VerifyRow[]
  /** True when any endpoint has issues or could not be read. */
  failed: boolean
}

/** One endpoint at a time, in file order, so the providers see a trickle. */
export async function verifyRegistry(
  families: readonly ModelFamily[],
  fetchSchema: FetchSchema
): Promise<VerifyReport> {
  const rows: VerifyRow[] = []
  for (const family of families) {
    for (const endpoint of family.endpoints) {
      const base = {
        familyId: family.id,
        endpoint: `${endpoint.provider}:${endpoint.model}`,
      }
      let result: FetchSchemaResult
      try {
        result = await fetchSchema(endpoint.provider, endpoint.model)
      } catch (error) {
        rows.push({
          ...base,
          status: "error",
          issues: [],
          note: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      if (result.status === "skipped") {
        rows.push({
          ...base,
          status: "skipped",
          issues: [],
          note: result.reason,
        })
        continue
      }
      const issues = checkEndpointAgainstSchema(endpoint, result.inputSchema)
      rows.push({
        ...base,
        status: issues.length === 0 ? "ok" : "issues",
        issues,
        note: null,
      })
    }
  }
  return {
    rows,
    failed: rows.some(
      (row) => row.status === "issues" || row.status === "error"
    ),
  }
}

function outcome(row: VerifyRow): string {
  switch (row.status) {
    case "ok":
      return "OK"
    case "skipped":
      return `skipped (${row.note ?? "no reason given"})`
    case "error":
      return `error: ${row.note ?? "unknown"}`
    case "issues":
      return `${row.issues.length} issue${row.issues.length === 1 ? "" : "s"}`
  }
}

/** `family · provider:model   OK | n issues | skipped (…)`, issues indented below. */
export function formatVerifyReport(report: VerifyReport): string {
  const labels = report.rows.map((row) => `${row.familyId} · ${row.endpoint}`)
  const width = Math.max(0, ...labels.map((label) => label.length))
  const lines: string[] = []
  report.rows.forEach((row, index) => {
    lines.push(`${labels[index]!.padEnd(width)}  ${outcome(row)}`)
    for (const issue of row.issues) {
      lines.push(`    ${issue.path}: ${issue.message}`)
    }
  })
  return lines.join("\n")
}

export interface VerifyArgs {
  /** Registry mode; implied by `--file`. */
  registry: boolean
  /** Extra family files, checked alongside (and replacing by id) the bundled ones. */
  files: string[]
}

/**
 * `--registry`, `--file <path>` / `--file=<path>` (repeatable). A bare `--`
 * is ignored because some pnpm versions forward it to the script.
 */
export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  const args: VerifyArgs = { registry: false, files: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === "--") continue
    if (arg === "--registry") {
      args.registry = true
    } else if (arg === "--file") {
      const path = argv[i + 1]
      if (path === undefined || path.startsWith("--")) {
        throw new Error("--file needs a path to a family JSON file.")
      }
      args.files.push(path)
      args.registry = true
      i += 1
    } else if (arg.startsWith("--file=")) {
      const path = arg.slice("--file=".length)
      if (!path) throw new Error("--file needs a path to a family JSON file.")
      args.files.push(path)
      args.registry = true
    } else {
      throw new Error(
        `Unknown argument "${arg}". Use --registry and optionally --file <path>.`
      )
    }
  }
  return args
}
