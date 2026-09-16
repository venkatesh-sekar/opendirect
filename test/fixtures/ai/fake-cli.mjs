#!/usr/bin/env node
/**
 * A stand-in for the `claude` and `codex` binaries.
 *
 * Every spawn test points `command` at this file instead of a real CLI: the
 * argv parsing, the JSON envelope, the non-zero exit and the hang are all
 * reproduced here, so nothing in the suite can reach a real assistant, spend a
 * subscription turn, or depend on either binary being installed.
 *
 * It reads its instructions from argv only — which is also what proves the
 * prompt survives as a single argument rather than going through a shell.
 */
const argv = process.argv.slice(2)

const isClaude = argv.includes("-p") && argv.includes("--output-format")
const prompt = isClaude ? (argv[argv.indexOf("-p") + 1] ?? "") : (argv.at(-1) ?? "")

if (prompt.includes("please fail")) {
  process.stderr.write("fake failure: not logged in\n")
  process.exit(3)
}

if (prompt.includes("please hang")) {
  // Never exits on its own: the caller's timeout or cancellation must kill it.
  setInterval(() => {}, 1000)
} else if (isClaude) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: `improved: ${prompt}`,
    })
  )
  process.exit(0)
} else {
  process.stdout.write(`codex saw: ${prompt}\n`)
  process.exit(0)
}
