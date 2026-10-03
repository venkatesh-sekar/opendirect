---
"@opendirect/desktop": patch
---

You can now set the duration of a video. The settings chip in the prompt bar (and in the generate panel) shows the length next to resolution and aspect ratio, and opens a Duration control for any video model that has one. It starts at the model's own default and is sent in the type and under the name the model expects: an integer range like Wan 3's 2–30 s, a list like Kling's 5 or 10 s, Sora's `seconds`, `"5s"`-style strings, or a frame count with its frame rate. The cost estimate updates as the duration changes. A seed, an audio switch or any other input that had no control in the bar is now under Advanced, and Advanced always opens once a model is chosen, even when every input is already on the bar.
