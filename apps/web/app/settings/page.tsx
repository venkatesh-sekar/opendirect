"use client"

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useHotkeys } from "react-hotkeys-hook"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { returnRoute } from "@/lib/shell/routes"

import { AiToolsForm } from "@/components/settings/ai-tools-form"
import { GeneralSettingsForm } from "@/components/settings/general-settings-form"
import { ModelsSettings } from "@/components/settings/models/models-settings"
import { ProviderKeysForm } from "@/components/settings/provider-keys-form"

const TABS = ["providers", "models", "general", "ai"] as const
type TabId = (typeof TABS)[number]

/** The tab named in `?tab=`, or the first one when it names nothing real. */
function tabFromSearch(value: string | null): TabId {
  return TABS.includes(value as TabId) ? (value as TabId) : "providers"
}

/**
 * Settings.
 *
 * The sidebar around it belongs to the root layout, so there is always a way
 * out. This screen carries two more of its own, because the sidebar can be
 * collapsed to icons and because a settings screen you can only leave with the
 * mouse is the bug this route was reported for: Escape, and a visible Back.
 */
function SettingsScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = tabFromSearch(searchParams.get("tab"))
  // `?map=<modelKey>`: the model picker's "map this model" link. The Models
  // tab opens the mapping editor on it once.
  const mapModelKey = tab === "models" ? searchParams.get("map") : null

  useHotkeys(
    "esc",
    (event) => {
      // A select, a popover or a dialog on this page answers Escape first —
      // leaving the screen as well would close two things with one key.
      if (event.defaultPrevented) return
      if (
        document.querySelector(
          '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"]'
        )
      ) {
        return
      }
      router.push(returnRoute())
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [router]
  )

  return (
    // `flex-1` so the status strip the shell renders underneath stays at the
    // bottom of the window rather than floating under short content, and
    // `min-h-0` + scrolling so a long tab does not push it off the screen.
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          onClick={() => router.push(returnRoute())}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Back
        </Button>
        <div>
          <h1 className="text-lg font-medium">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Provider credentials, model mappings, workspace preferences and AI
            helpers. Escape goes back.
          </p>
        </div>
      </div>

      {/*
        The tab lives in the URL so it can be linked to and so leaving and
        coming back does not always land on Providers. `replace`, not `push`:
        switching tabs is not a place in history you want Back to walk.
      */}
      <Tabs
        value={tab}
        onValueChange={(next) =>
          router.replace(`/settings?tab=${String(next)}`, { scroll: false })
        }
      >
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI helpers</TabsTrigger>
        </TabsList>
        <TabsContent value="providers" className="pt-4">
          <ProviderKeysForm />
        </TabsContent>
        <TabsContent value="models" className="pt-4">
          <ModelsSettings
            mapModelKey={mapModelKey}
            onEditorClosed={() =>
              router.replace("/settings?tab=models", { scroll: false })
            }
          />
        </TabsContent>
        <TabsContent value="general" className="pt-4">
          <GeneralSettingsForm />
        </TabsContent>
        <TabsContent value="ai" className="pt-4">
          <AiToolsForm />
        </TabsContent>
      </Tabs>
    </main>
  )
}

/**
 * `useSearchParams` suspends during the static export's prerender, where there
 * is no query string at all — the boundary is what lets the page be exported.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  )
}
