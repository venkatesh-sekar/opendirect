---
"@opendirect/desktop": patch
---

Cost estimates now follow a video model's resolution and duration. Models priced per second at each resolution, such as Wan 3.0 on OpenRouter, are quoted at the rate for the resolution you pick. Before, 1080p was quoted at the 480p rate. Rates in cents, minimum charges, per-image charges and image-to-video rates are read too. If no duration is set yet, the cost badge shows the rate (for example `$0.20/s`) instead of "Cost unknown". The confirmation box says why there is no estimate and links to the model's pricing page on the provider's site. Hand-maintained Replicate rates now live in `registry/pricing.json`, which also adds FLUX Schnell.
