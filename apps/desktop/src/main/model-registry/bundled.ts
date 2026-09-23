/**
 * The registry floor, compiled into the app so it works offline (design §4.1).
 *
 * Plain static JSON imports: tsup/esbuild inlines them into the main bundle,
 * so nothing reads `registry/` at runtime. `resolveJsonModule` is on in
 * packages/typescript-config/base.json. The `with { type: "json" }` form does
 * not compile here: main is CommonJS under NodeNext, and TS rejects import
 * attributes on statements that compile to `require` (TS2856).
 *
 * Values are `unknown` on purpose: the registry service validates them with
 * `modelFamilySchema` like any other layer, so a bad bundled file is reported
 * the same way a bad remote one is. `bundled.test.ts` fails when a file under
 * `registry/models/` is missing from this list.
 */
import index from "../../../../../registry/index.json"
import fluxSchnell from "../../../../../registry/models/flux-schnell.json"
import nanoBanana2 from "../../../../../registry/models/nano-banana-2.json"
import nanoBananaPro from "../../../../../registry/models/nano-banana-pro.json"
import seedance20 from "../../../../../registry/models/seedance-2-0.json"
import seedance25 from "../../../../../registry/models/seedance-2-5.json"

export const BUNDLED_INDEX: unknown = index

export const BUNDLED_FAMILIES: ReadonlyArray<{ origin: string; raw: unknown }> =
  [
    { origin: "registry/models/flux-schnell.json", raw: fluxSchnell },
    { origin: "registry/models/nano-banana-2.json", raw: nanoBanana2 },
    { origin: "registry/models/nano-banana-pro.json", raw: nanoBananaPro },
    { origin: "registry/models/seedance-2-0.json", raw: seedance20 },
    { origin: "registry/models/seedance-2-5.json", raw: seedance25 },
  ]
