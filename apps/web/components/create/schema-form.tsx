"use client"

/**
 * The generated half of the form.
 *
 * Replicate hands us literal JSON Schema and OpenRouter's capability map is
 * normalized into the same, so rendering an arbitrary model's parameters is a
 * library concern rather than ours: `@rjsf/shadcn` draws the fields and
 * `@rjsf/validator-ajv8` checks them. OpenDirect's contribution is the
 * partition in `split-schema.ts` — what reaches this form is *everything the
 * creation bar did not promote*, including fields no version of OpenDirect has
 * ever seen.
 *
 * The form is controlled and has no submit button of its own: Generate lives
 * in the bar, and this sheet only edits values.
 */
import { Form } from "@rjsf/shadcn"
import type { RJSFSchema, UiSchema } from "@rjsf/utils"
import validator from "@rjsf/validator-ajv8"

/** No submit button, and descriptions kept as help text under each field. */
const UI_SCHEMA: UiSchema = {
  "ui:submitButtonOptions": { norender: true },
}

export interface SchemaFormProps {
  schema: RJSFSchema
  formData: Record<string, unknown>
  onChange: (formData: Record<string, unknown>) => void
  idPrefix?: string
}

export function SchemaForm({
  schema,
  formData,
  onChange,
  idPrefix = "advanced",
}: SchemaFormProps) {
  return (
    <Form
      schema={schema}
      uiSchema={UI_SCHEMA}
      validator={validator}
      formData={formData}
      idPrefix={idPrefix}
      liveValidate={false}
      showErrorList={false}
      onChange={(event) =>
        onChange((event.formData ?? {}) as Record<string, unknown>)
      }
    />
  )
}
