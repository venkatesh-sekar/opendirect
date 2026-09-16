#!/usr/bin/env node
/**
 * A stand-in for the `claude` and `codex` binaries.
 *
 * Every spawn test points `command` at this file instead of a real CLI: the
 * stdin handoff, the JSON envelope, the non-zero exit and the hang are all
 * reproduced here, so nothing in the suite can reach a real assistant, spend a
 * subscription turn, or depend on either binary being installed.
 *
 * The prompt arrives on **stdin**, like both real CLIs, which is also what
 * proves a 200KB prompt never has to fit in an argv entry. What the fixture
 * can see of the environment is reported back on request, so a test can assert
 * that the provider API keys were not handed to a child process.
 */
import { readFileSync } from "node:fs"

const argv = process.argv.slice(2)
const isClaude = argv.includes("-p") && argv.includes("--output-format")

let prompt = ""
try {
  prompt = readFileSync(0, "utf8")
} catch {
  prompt = ""
}

/** What the parent decided this child may see of the environment. */
function envReport() {
  const names = [
    "REPLICATE_API_TOKEN",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "PATH",
  ]
  return JSON.stringify(
    Object.fromEntries(names.map((name) => [name, name in process.env]))
  )
}

if (prompt.includes("please fail")) {
  process.stderr.write("fake failure: not logged in\n")
  // `process.exit` would truncate a pending write; setting the code and
  // falling off the end lets stdio flush first — which is exactly what the
  // 300KB-prompt test is here to prove.
  process.exitCode = 3
}

const answer = prompt.includes("env check")
  ? envReport()
  : isClaude
    ? `improved: ${prompt}`
    : `codex saw: ${prompt}`

if (prompt.includes("please hang")) {
  // Never exits on its own: the caller's timeout or cancellation must kill it.
  setInterval(() => {}, 1000)
} else if (process.exitCode) {
  // Failed above; nothing to say on stdout.
} else if (isClaude) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: answer,
    })
  )
} else {
  process.stdout.write(`${answer}\n`)
}
