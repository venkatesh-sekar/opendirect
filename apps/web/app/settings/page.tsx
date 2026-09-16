"use client"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { GeneralSettingsForm } from "@/components/settings/general-settings-form"
import { ProviderKeysForm } from "@/components/settings/provider-keys-form"

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Provider credentials and workspace preferences.
        </p>
      </div>

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>
        <TabsContent value="providers" className="pt-4">
          <ProviderKeysForm />
        </TabsContent>
        <TabsContent value="general" className="pt-4">
          <GeneralSettingsForm />
        </TabsContent>
      </Tabs>
    </main>
  )
}
