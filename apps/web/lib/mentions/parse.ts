/**
 * Reading `@venkz` out of a prompt. Pure — no DOM, no IPC, no state.
 *
 * The prompt is a plain string from the textarea to `generations.prompt`, so
 * a mention is characters in that string and nothing else. There is no
 * document model to keep in sync, and a prompt written today still replays
 * years from now because it is exactly what was submitted.
 *
 * ⛔ Nothing here corrects a near-miss. `@nobdy` is reported as it was typed
 * and stays in the prompt verbatim; a silently "fixed" mention would be a paid
 * mistake.
 */

/**
 * `@venkz`, only at a word boundary.
 *
 * The lookbehind is what keeps `venkz@example.com` out: a handle starts the
 * string, or follows something that is not a letter, digit, underscore or
 * another `@`. The handle body is `handle.ts`'s own alphabet — lowercase,
 * digits and single hyphens — so a trailing `.` or `-` is left in the prose
 * where it belongs.
 */
export const MENTION_PATTERN =
  /(?<![\p{L}\p{N}_@])@([a-z0-9]+(?:-[a-z0-9]+)*)/gu

/** Characters that can be part of a handle *as it is being typed*. */
const QUERY_CHAR = /[A-Za-z0-9-]/

export interface MentionToken {
  handle: string
  /** Index of the `@`. */
  start: number
  /** Index just past the last character of the handle. */
  end: number
}

/** Every mention in the text, in order of appearance, duplicates included. */
export function findMentions(text: string): MentionToken[] {
  // A fresh regex per call: `MENTION_PATTERN` is global, and a shared
  // `lastIndex` would make the second call on the same string return less
  // than the first.
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)
  const tokens: MentionToken[] = []
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    tokens.push({
      handle: match[1]!,
      start,
      end: start + match[0].length,
    })
  }
  return tokens
}

export interface MentionQuery {
  /** What has been typed after the `@`, verbatim. May be `""`. */
  query: string
  /** Index of the `@`. */
  start: number
  /** The caret — the picker replaces `[start, end)`. */
  end: number
}

/**
 * The mention being typed at the caret, or null.
 *
 * Only what is *behind* the caret counts, so putting the caret in the middle
 * of `@venkz` offers the list again for `ven` rather than for the whole word:
 * the user is editing the part they can see themselves changing.
 */
export function activeMentionQuery(
  text: string,
  caret: number
): MentionQuery | null {
  let index = Math.max(0, Math.min(caret, text.length))
  while (index > 0 && QUERY_CHAR.test(text[index - 1]!)) index -= 1

  const start = index - 1
  if (start < 0 || text[start] !== "@") return null
  // The same word boundary `MENTION_PATTERN` enforces, so an email address
  // never opens the picker.
  const before = text[start - 1]
  if (before !== undefined && /[\p{L}\p{N}_@]/u.test(before)) return null

  return { query: text.slice(start + 1, caret), start, end: caret }
}

/**
 * Replaces `range` with `@handle ` and returns the new text and caret.
 *
 * The trailing space is what closes the picker and lets the next word be
 * typed straight away; it is not added twice when the prompt already has one.
 */
export function insertMention(
  text: string,
  range: { start: number; end: number },
  handle: string
): { text: string; caret: number } {
  const before = text.slice(0, range.start)
  const after = text.slice(range.end)
  const spaced = after.startsWith(" ") ? "" : " "
  const inserted = `@${handle}${spaced}`
  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + `@${handle}`.length + 1,
  }
}
