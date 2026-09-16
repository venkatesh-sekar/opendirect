"use client"

import { useState } from "react"
import type { KeyStatus, ProviderId } from "@opendirect/contract"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import {
  PROVIDER_ENV_VARS,
  PROVIDER_LABELS,
  useClearKey,
  useKeysSummary,
  useSaveKey,
  useVerifyKey,
} from "@/lib/settings"

const PROVIDERS: readonly ProviderId[] = ["replicate", "openrouter"]

type VerifyState = { valid: boolean; message?: string }

function StatusBadge({ status }: { status: KeyStatus }) {
  if (!status.present) return <Badge variant="outline">Not set</Badge>
  return (
    <Badge variant={status.source === "env" ? "secondary" : "default"}>
      {status.last4 ? `•••• ${status.last4}` : "••••"}
      {status.source === "env" ? " · from .env.local" : ""}
    </Badge>
  )
}

function ProviderRow({ provider }: { provider: ProviderId }) {
  const [draft, setDraft] = useState("")
  const [verified, setVerified] = useState<VerifyState | null>(null)

  const summary = useKeysSummary()
  const save = useSaveKey()
  const clear = useClearKey()
  const verify = useVerifyKey()

  const status: KeyStatus = summary.data?.[provider] ?? {
    present: false,
    last4: null,
    source: "none",
  }
  const inputId = `api-key-${provider}`
  const busy = save.isPending || clear.isPending || verify.isPending

  return (
    <div className="flex flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId}>{PROVIDER_LABELS[provider]} API key</Label>
        <StatusBadge status={status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          // Masked at rest and in transit: the stored key is never sent back to
          // the renderer, so this field always starts empty.
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            status.present ? "Enter a new key to replace it" : "Paste your key"
          }
          className="min-w-64 flex-1"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setVerified(null)
          }}
        />
        <Button
          disabled={busy || draft.trim().length === 0}
          onClick={() => {
            save.mutate(
              { provider, key: draft.trim() },
              { onSuccess: () => setDraft("") }
            )
          }}
        >
          Save
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status.present}
          onClick={() => {
            setVerified(null)
            verify.mutate(provider, { onSuccess: setVerified })
          }}
        >
          {verify.isPending ? "Testing…" : "Test"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || status.source !== "vault"}
          onClick={() => {
            setVerified(null)
            clear.mutate(provider)
          }}
        >
          Clear
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Test calls only the provider&apos;s read-only model listing endpoint —
        it never starts a paid generation. Without a saved key, OpenDirect falls
        back to <code className="font-mono">{PROVIDER_ENV_VARS[provider]}</code>{" "}
        from <code className="font-mono">.env.local</code> during development.
      </p>

      {verified ? (
        <p
          role="status"
          className={
            verified.valid
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
        >
          {verified.valid
            ? "Key verified against the provider's model listing."
            : (verified.message ?? "The provider rejected this key.")}
        </p>
      ) : null}

      {save.isError ? (
        <p className="text-xs text-destructive">{save.error.message}</p>
      ) : null}
    </div>
  )
}

export function ProviderKeysForm() {
  const summary = useKeysSummary()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider keys</CardTitle>
        <CardDescription>
          Keys are held by the desktop app only and are encrypted with your
          operating system&apos;s keychain. They are never shown again after
          saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {summary.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not read your keys</AlertTitle>
            <AlertDescription>{summary.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {summary.data && !summary.data.encryptionAvailable ? (
          <Alert variant="destructive">
            <AlertTitle>OS encryption unavailable</AlertTitle>
            <AlertDescription>
              This system has no usable keychain, so API keys are stored
              unencrypted in the app&apos;s settings file. Install a keyring
              (for example gnome-keyring or kwallet) and re-save your keys.
            </AlertDescription>
          </Alert>
        ) : null}

        {PROVIDERS.map((provider) => (
          <ProviderRow key={provider} provider={provider} />
        ))}
      </CardContent>
    </Card>
  )
}
