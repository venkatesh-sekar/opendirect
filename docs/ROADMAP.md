# Roadmap

Things OpenDirect could do next, written down so they are decisions rather
than surprises. Nothing here is built.

## An OpenRouter fallback for the AI helpers

The four helpers — Improve prompt, Describe reference, Analyze video, Suggest
shots — are served today by whichever of `claude` or `codex` the user already
has installed (`apps/desktop/src/main/ai/`). That is deliberate: the help runs
on the user's own subscription, on their own machine, and costs OpenDirect's
provider credits nothing.

The same four could be served by an OpenRouter **text** model through
`client.callModel()`, behind the same interface they already have:
`runHelper(request, run)` in `ai/helpers.ts` takes its runner as an argument,
so an OpenRouter runner would slot in beside `runTool` in `ai-service.ts` with
no change to the prompts, the parsing or any of the UI.

Two things must be true before it ships:

- **It is off by default and gated by a Settings toggle.** Unlike the CLIs,
  this spends the user's OpenRouter credits, so it may never become the silent
  fallback when no CLI is detected. "No local CLI" must keep meaning "no AI
  menus" unless the user has explicitly turned this on.
- **The cost is shown the way generation cost is.** OpenRouter returns
  `usage.cost` on completion; a helper run that spends money belongs in the
  same accounting as a generation, not in a footnote.

The reference-reading helpers (Describe reference, Analyze video) also need a
multimodal model and an upload path — a local CLI can simply be handed the
file path, an HTTP model cannot. That is the main reason this is a fallback
and not the default.

## A helper that ranks references

The reference picker has an inert "✨ Suggest" button, from the task that built
it. Choosing *which* references go into a run is a heavier promise than the
four shipped helpers: it decides what the user pays for. It stays disabled, and
visible, until there is a helper behind it worth trusting with that.
