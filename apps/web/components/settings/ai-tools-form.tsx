"use client"

/**
 * The AI helpers, in Settings: what was detected, and which one answers.
 *
 * This is the one screen that mentions the helpers when neither CLI is
 * installed — everywhere else in the app they are simply absent. Here it is
 * the right thing to say, because "install `claude` or `codex` and press
 * Re-detect" is actionable, and because the user came to this tab to ask.
 *
 * ⛔ Nothing here runs a prompt. Detection is `which` and `--version`.
 */
import { aiToolModelsDefaults, type AiToolId } from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"

import { AiModelPicker } from "@/components/ai/model-picker"
import { useAiTools, useRedetectAiTools } from "@/hooks/use-ai"
import { useSettings, useUpdateSettings } from "@/lib/settings"

import { FieldError } from "./field-error"

const TOOLS: { id: AiToolId; install: string }[] = [
  { id: "claude", install: "npm i -g @anthropic-ai/claude-code" },
  { id: "codex", install: "npm i -g @openai/codex" },
]

export function AiToolsForm() {
  const tools = useAiTools()
  const redetect = useRedetectAiTools()
  const settings = useSettings()
  const update = useUpdateSettings()

  const detected = tools.data
  const preferred = settings.data?.preferredAiTool ?? null
  const models = settings.data?.aiModels ?? aiToolModelsDefaults

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI helpers</CardTitle>
        <CardDescription>
          OpenDirect borrows the <code className="font-mono">claude</code> or{" "}
          <code className="font-mono">codex</code> CLI you already have
          installed. It runs on your machine, on your own subscription, and only
          when you press one of the ✨ menus. When neither is installed those
          menus are not shown at all.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="flex flex-col gap-3">
          {TOOLS.map(({ id, install }) => {
            const status = detected?.[id]
            return (
              <li key={id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono">{id}</span>
                  <Badge variant={status?.available ? "secondary" : "outline"}>
                    {status?.available
                      ? (status.version ?? "installed")
                      : "not found on PATH"}
                  </Badge>
                </div>
                {status?.available ? (
                  <>
                    <p className="font-mono text-xs text-muted-foreground">
                      {status.path}
                    </p>
                    {settings.data ? (
                      <div className="mt-1 flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="flex h-8 shrink-0 items-center">
                          Model
                        </span>
                        <AiModelPicker
                          tool={id}
                          value={models[id]}
                          disabled={update.isPending}
                          className="w-64"
                          label={`Default ${id} model`}
                          onChange={(next) =>
                            update.mutate({
                              aiModels: { ...models, [id]: next },
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="font-mono text-xs text-muted-foreground">
                    {install}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {detected && detected.claude.available && detected.codex.available ? (
          <div className="flex flex-col gap-2">
            <Label>Default CLI</Label>
            <div className="flex items-center gap-2">
              {TOOLS.map(({ id }) => (
                <Button
                  key={id}
                  size="sm"
                  variant={preferred === id ? "default" : "outline"}
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({
                      preferredAiTool: preferred === id ? null : id,
                    })
                  }
                >
                  {id}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Which one every ✨ menu opens on. Picking the other there is for
              that run only, unless you press Set as default.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={redetect.isPending}
            onClick={() => redetect.mutate()}
          >
            {redetect.isPending ? "Looking…" : "Re-detect"}
          </Button>
          <FieldError>
            {redetect.isError ? redetect.error.message : null}
          </FieldError>
        </div>
      </CardContent>
    </Card>
  )
}
