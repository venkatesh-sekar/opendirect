"use client"

/**
 * Where an AI answer stops and the user decides.
 *
 * Every helper ends here, and nothing leaves here on its own: Apply puts the
 * text where the user asked for it, Copy hands it to the clipboard, Discard
 * throws it away. A helper that quietly rewrote the prompt field would be
 * OpenDirect editing the user's work without being asked — so the answer is
 * shown as text first, always.
 *
 * While a run is in flight the dialog is the progress: a live tail of the
 * CLI's own output, and a Stop button that kills the child process.
 */
import { useState } from "react"
import { AI_HELPER_LABELS } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import type { AiHelperController } from "@/hooks/use-ai"

export interface HelperResultDialogProps {
  controller: AiHelperController
  /** What "Apply" does on this surface. Omitted when there is nowhere to put it. */
  onApply?: (text: string) => void
  applyLabel?: string
  /** Inserts one line of a list-shaped answer, e.g. a single suggested shot. */
  onInsertShot?: (shot: string) => void
}

export function HelperResultDialog({
  controller,
  onApply,
  applyLabel = "Apply",
  onInsertShot,
}: HelperResultDialogProps) {
  const [copied, setCopied] = useState(false)
  const { state, helper, result, error, log } = controller

  if (state === "idle" || !helper) return null

  const running = state === "running"
  const title = AI_HELPER_LABELS[helper]

  function close(): void {
    if (running) controller.cancel()
    controller.reset()
    setCopied(false)
  }

  async function copy(): Promise<void> {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {running
              ? `Running locally with ${result?.tool ?? "your AI CLI"}. Nothing is applied until you say so.`
              : "Read it, then choose what to do with it. Nothing has been applied."}
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-muted-foreground">
              Waiting for the CLI…
            </p>
            {log.length > 0 ? (
              <ScrollArea className="max-h-32 rounded-md bg-muted p-2">
                <pre className="font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {log.join("")}
                </pre>
              </ScrollArea>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {result ? (
          <ScrollArea className="max-h-72">
            <p
              data-testid="ai-result-text"
              className="text-sm whitespace-pre-wrap"
            >
              {result.text}
            </p>

            {onInsertShot && result.shots.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                {result.shots.map((shot, index) => (
                  <li
                    key={`${index}-${shot}`}
                    className="flex items-start gap-2"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 shrink-0"
                      onClick={() => onInsertShot(shot)}
                    >
                      Insert
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {shot}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </ScrollArea>
        ) : null}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={close}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Discard
              </Button>
              <Button
                variant="outline"
                disabled={!result}
                onClick={() => void copy()}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              {onApply ? (
                <Button
                  disabled={!result}
                  onClick={() => {
                    if (!result) return
                    onApply(result.text)
                    controller.reset()
                  }}
                >
                  {applyLabel}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
