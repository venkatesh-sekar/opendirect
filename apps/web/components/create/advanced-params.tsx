"use client"

/**
 * The Advanced sheet: every parameter the bar did not promote, plus the exact
 * payload the run will be recorded with.
 *
 * It opens as a right-hand sheet rather than another disclosure in the bar
 * because an unfamiliar model can have twenty inputs, and a bar that grows to
 * half the window stops being a bar. The JSON preview at the bottom is
 * read-only and is the same object `generations:submit` receives — the fastest
 * way to answer "what exactly is this going to send?".
 */
import type { GenerationRequest } from "@opendirect/contract"
import type { RJSFSchema } from "@rjsf/utils"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

import type { AdvancedSchema } from "@/lib/schema-form/split-schema"

import { SchemaForm } from "./schema-form"

export interface AdvancedParamsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelName: string
  schema: AdvancedSchema
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  /** The request as it stands, for the read-only preview. */
  request: GenerationRequest | null
}

export function AdvancedParams({
  open,
  onOpenChange,
  modelName,
  schema,
  values,
  onChange,
  request,
}: AdvancedParamsProps) {
  const fieldCount = Object.keys(schema.properties).length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-lg"
        aria-label={`Advanced parameters for ${modelName}`}
      >
        <SheetHeader className="border-b">
          <SheetTitle>Advanced parameters</SheetTitle>
          <SheetDescription>
            {fieldCount === 0
              ? `${modelName} has no parameters beyond the ones in the bar.`
              : `Every remaining input ${modelName} publishes, straight from its own schema.`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4">
            {fieldCount > 0 ? (
              <SchemaForm
                schema={schema as RJSFSchema}
                formData={values}
                onChange={onChange}
              />
            ) : null}

            <div>
              <h3 className="text-sm font-medium">Request preview</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Exactly what pressing Generate records.
              </p>
              <pre
                data-testid="request-preview"
                className="mt-2 overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed"
              >
                {request
                  ? JSON.stringify(request, null, 2)
                  : "Pick a model to see the request."}
              </pre>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
