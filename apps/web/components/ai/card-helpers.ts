/**
 * Which AI helpers a board tile offers.
 *
 * A description is only meaningful for something you can look at, and an
 * analysis only for something that moves — so the menu is derived from the
 * asset's kind rather than being a fixed list with two items disabled. On a
 * tile there is no room to explain why an item is off, and an AI menu that
 * offers "Analyze video" for a PNG is worse than one that does not.
 */
import type { AiHelperId, AssetDto } from "@opendirect/contract"

export function cardHelpers(asset: AssetDto): AiHelperId[] {
  if (asset.kind === "video") return ["analyze-video", "describe-reference"]
  if (asset.kind === "image") return ["describe-reference"]
  return []
}
