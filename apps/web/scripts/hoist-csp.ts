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

import { hoistCspMeta } from "../lib/csp.ts"

const outDir = join(fileURLToPath(new URL("..", import.meta.url)), "out")

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(path)
    else if (entry.name.endsWith(".html")) yield path
  }
}

let rewritten = 0
for await (const file of htmlFiles(outDir)) {
  const html = await readFile(file, "utf8")
  const hoisted = hoistCspMeta(html)
  if (hoisted === html) continue
  await writeFile(file, hoisted)
  rewritten += 1
}

console.log(`hoist-csp: hoisted the CSP meta tag in ${rewritten} file(s)`)
