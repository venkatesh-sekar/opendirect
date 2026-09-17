import Ajv from "ajv"
import type { GenerationRequest, ModelDescriptor } from "@opendirect/contract"

// Providers use descriptive extension keywords and URI formats. Validation
// checks structure and constraints without resolving remote references.
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  useDefaults: true,
  validateFormats: false,
})

export function validateGenerationParams(
  descriptor: ModelDescriptor,
  request: GenerationRequest
): void {
  const params = structuredClone(request.params)
  if (descriptor.commonControls.prompt && request.prompt?.trim())
    params[descriptor.commonControls.prompt] = request.prompt
  for (const slot of descriptor.referenceSlots) {
    const refs = request.references.filter(
      (ref) => ref.slotField === slot.field
    )
    if (refs.length) {
      const placeholders = refs.map(
        (ref) => `https://reference.invalid/${encodeURIComponent(ref.assetId)}`
      )
      params[slot.field] = slot.multiple ? placeholders : placeholders[0]
    }
  }
  let validate
  try {
    validate = ajv.compile(descriptor.inputSchema)
  } catch {
    throw new Error(
      "This model's input schema could not be validated. Refresh the catalog or choose another model."
    )
  }
  if (!validate(params)) {
    throw new Error(
      "Check model settings: " +
        ajv.errorsText(validate.errors, { separator: "; " })
    )
  }
}
