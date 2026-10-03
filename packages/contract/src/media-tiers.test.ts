import { describe, expect, it } from "vitest"

import { assetTierUrl, parseAssetTier } from "./media-tiers"

const URL = "asset://media/assets/2026/10/a%20b.jpg"

describe("asset tier URLs", () => {
  it("round-trips every tier", () => {
    expect(assetTierUrl(URL, 1024)).toBe(`${URL}?w=1024`)
    expect(parseAssetTier(assetTierUrl(URL, 1024))).toBe(1024)
    expect(parseAssetTier(assetTierUrl(URL, 2048))).toBe(2048)
  })

  it("reads no tier from the original, an unknown size or junk", () => {
    expect(parseAssetTier(URL)).toBeNull()
    expect(parseAssetTier(`${URL}?w=777`)).toBeNull()
    expect(parseAssetTier(`${URL}?w=1024px`)).toBeNull()
    expect(parseAssetTier(`${URL}?xw=1024`)).toBeNull()
  })

  it("finds the tier among other parameters", () => {
    expect(parseAssetTier(`${URL}?v=2&w=2048#frag`)).toBe(2048)
    expect(assetTierUrl(`${URL}?v=2`, 1024)).toBe(`${URL}?v=2&w=1024`)
  })
})
