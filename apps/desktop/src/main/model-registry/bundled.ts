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
import flux2Pro from "../../../../../registry/models/flux-2-pro.json"
import fluxSchnell from "../../../../../registry/models/flux-schnell.json"
import gptImage15 from "../../../../../registry/models/gpt-image-1-5.json"
import gptImage2 from "../../../../../registry/models/gpt-image-2.json"
import gptImage25Flare from "../../../../../registry/models/gpt-image-2-5-flare.json"
import gptImage25Sunburst from "../../../../../registry/models/gpt-image-2-5-sunburst.json"
import hailuo23 from "../../../../../registry/models/hailuo-2-3.json"
import ideogramV3Turbo from "../../../../../registry/models/ideogram-v3-turbo.json"
import imagen4Fast from "../../../../../registry/models/imagen-4-fast.json"
import kling25TurboPro from "../../../../../registry/models/kling-2-5-turbo-pro.json"
import ltx2Fast from "../../../../../registry/models/ltx-2-fast.json"
import nanoBanana2 from "../../../../../registry/models/nano-banana-2.json"
import nanoBananaPro from "../../../../../registry/models/nano-banana-pro.json"
import pImage from "../../../../../registry/models/p-image.json"
import pVideo from "../../../../../registry/models/p-video.json"
import qwenImage from "../../../../../registry/models/qwen-image.json"
import seedance20 from "../../../../../registry/models/seedance-2-0.json"
import seedance25 from "../../../../../registry/models/seedance-2-5.json"
import seedream45 from "../../../../../registry/models/seedream-4-5.json"
import veo31 from "../../../../../registry/models/veo-3-1.json"
import veo31Fast from "../../../../../registry/models/veo-3-1-fast.json"
import wan3 from "../../../../../registry/models/wan-3.json"

export const BUNDLED_INDEX: unknown = index

export const BUNDLED_FAMILIES: ReadonlyArray<{ origin: string; raw: unknown }> =
  [
    { origin: "registry/models/flux-2-pro.json", raw: flux2Pro },
    { origin: "registry/models/flux-schnell.json", raw: fluxSchnell },
    { origin: "registry/models/gpt-image-1-5.json", raw: gptImage15 },
    { origin: "registry/models/gpt-image-2.json", raw: gptImage2 },
    {
      origin: "registry/models/gpt-image-2-5-flare.json",
      raw: gptImage25Flare,
    },
    {
      origin: "registry/models/gpt-image-2-5-sunburst.json",
      raw: gptImage25Sunburst,
    },
    { origin: "registry/models/hailuo-2-3.json", raw: hailuo23 },
    { origin: "registry/models/ideogram-v3-turbo.json", raw: ideogramV3Turbo },
    { origin: "registry/models/imagen-4-fast.json", raw: imagen4Fast },
    {
      origin: "registry/models/kling-2-5-turbo-pro.json",
      raw: kling25TurboPro,
    },
    { origin: "registry/models/ltx-2-fast.json", raw: ltx2Fast },
    { origin: "registry/models/nano-banana-2.json", raw: nanoBanana2 },
    { origin: "registry/models/nano-banana-pro.json", raw: nanoBananaPro },
    { origin: "registry/models/p-image.json", raw: pImage },
    { origin: "registry/models/p-video.json", raw: pVideo },
    { origin: "registry/models/qwen-image.json", raw: qwenImage },
    { origin: "registry/models/seedance-2-0.json", raw: seedance20 },
    { origin: "registry/models/seedance-2-5.json", raw: seedance25 },
    { origin: "registry/models/seedream-4-5.json", raw: seedream45 },
    { origin: "registry/models/veo-3-1.json", raw: veo31 },
    { origin: "registry/models/veo-3-1-fast.json", raw: veo31Fast },
    { origin: "registry/models/wan-3.json", raw: wan3 },
  ]
