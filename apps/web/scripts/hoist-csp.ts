/**
 * Post-build step for the static export.
 *
 * React hoists `<meta>` to the end of `<head>`, which puts the CSP tag behind
 * Next's async script tags — and a meta policy only governs content parsed
 * after it. This moves the tag to the front of `<head>` in every exported page.
 *
 * Run with plain `node` (Node >= 22.18 strips the types).
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { cspMetaIsFirst, hoistCspMeta } from "../lib/csp.ts"

const outDir = join(fileURLToPath(new URL("..", import.meta.url)), "out")

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(path)
    else if (entry.name.endsWith(".html")) yield path
  }
}

let seen = 0
let rewritten = 0
/** Pages that carry a CSP tag this script could not move to the front. */
const stuck: string[] = []

for await (const file of htmlFiles(outDir)) {
  seen += 1
  const html = await readFile(file, "utf8")
  const hoisted = hoistCspMeta(html)
  if (hoisted !== html) {
    await writeFile(file, hoisted)
    rewritten += 1
    continue
  }
  // Unchanged is fine only when the tag is already first. Unchanged *because
  // the tag could not be found or moved* means the exported page ships a
  // policy that governs nothing — silently, which is the whole problem.
  if (html.includes("Content-Security-Policy") && !cspMetaIsFirst(html)) {
    stuck.push(file)
  }
}

if (seen === 0) {
  console.error(
    `hoist-csp: found no exported HTML in ${outDir} — did \`next build\` run?`
  )
  process.exit(1)
}

if (stuck.length > 0) {
  console.error(
    `hoist-csp: could not hoist the CSP meta tag in ${stuck.length} file(s):`
  )
  for (const file of stuck) console.error(`  ${file}`)
  // A non-zero exit is the point: a build that cannot place the policy must
  // fail loudly rather than package a renderer whose CSP is decoration.
  process.exit(1)
}

console.log(
  `hoist-csp: hoisted the CSP meta tag in ${rewritten} of ${seen} file(s)`
)
