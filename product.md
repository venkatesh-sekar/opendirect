Yes. I think your clarification actually makes the product much better.

The mistake would be turning this into a **workflow engine for making AI movies**. What you're describing is closer to a **visual workspace for generative media**, where users decide the workflow.

The app should understand relationships between things, but it should **not decide what those relationships mean for the user**.

## The central abstraction

I would reduce almost everything to three concepts:

**Container → Asset → Generation**

A **Character** is a container.

A **Scene** is a container.

A **Project** is a container.

Inside any container you can have assets:

image
video
audio
text/note
prompt
generated image
generated video
uploaded reference
character sheet
storyboard
anything else later

And importantly:

> **"Character sheet" should not be a special technical object required by the system.**

It's simply an image asset that the user may label or pin as a character sheet.

So you might have:

**Character: Venkatesh**

`portrait.jpg`
`full-body.png`
`character-sheet-v3.png` ⭐ Character Sheet
`side-profile.jpg`
`hotel-scene-output.png`
`walking-reference.mp4`

Maybe tomorrow Seedance works best with the character sheet.

Six months later some new model works better with three ordinary photographs.

Nothing breaks.

That's exactly the flexibility you want.

---

# References should be universal

This is probably the most important UX concept.

Anywhere you're generating something, there is simply:

**References**

And you drag/select anything into it.

For example:

> References
> [Venkatesh sheet] [Hotel hallway] [Camera motion.mp4] [Lighting ref]

Then underneath:

**Model**
`Seedance 2.5 ▼`

**Prompt**
`Venkatesh slowly approaches...`

**Generate**

That's it.

The app should not say:

> "Select character reference"

unless the particular model itself requires such an input.

If a model exposes:

`reference_images`

then show references.

If it exposes:

`first_frame`

show First Frame.

If it exposes:

`last_frame`

show Last Frame.

If it supports:

`motion_reference`

show Motion Reference.

This is particularly feasible now because OpenRouter exposes video-model capabilities programmatically, including supported duration, resolution, aspect ratio, frame-image support, reference-image support, audio support and provider-specific parameters. ([OpenRouter][1])

Replicate goes even further: you can retrieve the actual OpenAPI input/output schema for individual models. ([Replicate][2])

So **the model itself can largely describe the UI**.

---

# I would NOT make the primary UI a node graph

This is where I'd differ slightly from your "node" wording.

Internally? Absolutely.

Everything can be a graph:

`Character → image → generation → image → generation → video`

But users shouldn't normally need to look at wires.

ComfyUI exposes the graph directly. That makes it extraordinarily flexible, but it also makes simple creative tasks feel like engineering. ComfyUI itself describes its node graph as giving control over every model, parameter, and output.

I would hide that complexity.

Think more **Figma**, less **ComfyUI**.

The underlying system is node-based.

The experience is:

> objects + cards + references + drag/drop

Maybe later there is:

**View → Graph**

for power users.

---

# What I think the interface should actually look like

Imagine opening your project for the Infinite Hotel movie.

### Left

**PROJECT**

Characters
Scenes
Assets
Generations

Then beneath:

**Characters**

Venkatesh
Nikita

**Scenes**

Infinite Hotel
Elevator
Bangalore 2022
The Door

But these are just containers.

---

### Middle

You're inside:

## Infinite Hotel

Big visual masonry/grid view.

You see your:

hotel concept art
generated hallway
elevator video
door reference
lighting photo
storyboard image
failed generations
approved generations

Almost like a visual mood board / asset board.

You can drag things around if you want.

---

### Bottom

A persistent creation bar:

`+ References`
`Describe what you want...`
`Seedance 2.5 ▼`
`16:9 ▼`
**Generate**

That should probably be the heart of the product.

No wizard.

No:

Step 1
Step 2
Step 3

Just **create**.

---

# And then progressive disclosure

Your idea about double clicking is exactly where I would go.

Normal view:

> **Seedance 2.5**
> 8 sec · 1080p · 16:9
> Generate

Click settings:

> Duration
> Resolution
> Aspect ratio
> Audio
> Seed
> etc.

Double-click / Advanced:

> Every native model parameter
> Request JSON
> Provider
> Model version
> Raw prompt
> API response
> Generation logs

So a beginner sees six controls.

You can see sixty.

Same product.

---

# This is where Replicate becomes very interesting

Replicate is almost ideal as another backend for this architecture.

Replicate currently has official models across images and video, and its official-model system promises stable APIs, predictable pricing, active maintenance and always-on availability. ([Replicate][3])

But more importantly, every model exposes its own schema.

For example, Runway Gen-4 Image on Replicate exposes:

`prompt`
`resolution`
`aspect_ratio`
`reference_tags`
`reference_images`

and supports up to three reference images. ([Replicate][4])

Your application doesn't need:

```text
if model == runway_gen4:
    show_reference_images()
```

Instead:

```text
Model schema
      ↓
UI renderer
      ↓
appropriate controls
```

That is a very powerful architecture.

---

# OpenRouter is actually even better for your V1 now

OpenRouter launched its unified video API in April 2026.

It now normalizes things such as:

duration
resolution
aspect ratio
audio
frame images
reference images

across video providers, while still allowing **model-specific passthrough parameters**. ([OpenRouter][1])

And its image API similarly supports many models while exposing differences in capability, because image models can have wildly different reference-image limits and aspect ratios. ([OpenRouter][5])

So I would architect:

```text
                 Your App
                    │
             Model Registry
                    │
          ┌─────────┴─────────┐
          │                   │
      OpenRouter          Replicate
          │                   │
   unified schema         native schemas
          │                   │
       Models              Models
```

Later:

```text
ComfyUI
Fal.ai
Local models
Direct provider APIs
Custom HTTP
```

become additional adapters.

---

# But don't normalize away features

This is crucial.

Suppose:

Model A supports:

> prompt + image

Model B supports:

> prompt + 10 references + first frame + last frame + motion video

Model C supports:

> prompt + character identity + audio + camera path

Don't create a universal interface that only exposes:

> Prompt + Image

because that's the intersection.

Instead:

### Common controls

Beautifully presented.

Then:

### Model controls

Generated dynamically.

That lets the application survive the next five generations of models.

---

# References and model limitations

There's another subtle UX issue.

Suppose a character contains **100 images**.

The user selects the character container as a reference.

Seedance accepts 12 references.

Some other model accepts 4.

**Do not silently choose the four "best" images.**

That's exactly the kind of hidden intelligence I think you're saying you don't want.

Instead show:

> **Venkatesh**
> 100 assets
>
> Seedance supports 12 references.
> **Select references →**

And perhaps remember that selection for that generation.

You can offer:

> ✨ Suggest 12

But the user has to explicitly press it.

Huge difference.

---

# Same philosophy for AI helpers

You can have extremely powerful AI inside this product.

But AI should behave like **tools**, not an invisible director.

For example:

`Generate character sheet`

`Improve prompt`

`Describe this reference`

`Create shot ideas`

`Extract frames`

`Generate storyboard`

`Suggest camera movement`

`Check character consistency`

`Turn scene description into shots`

All excellent.

But nothing should happen because:

> "the system decided this is the best workflow."

The blank generation box should always work.

---

# The workflow I now picture

A user should be able to do this:

1. Create **Infinite Hotel** project.
2. Create **Venkatesh** character container and drop six photos into it.
3. Select those six photos → Generate → choose an image model → type "neutral character reference sheet" → Generate.
4. Drag the result back into Venkatesh and optionally label it `Character Sheet`.
5. Create **Hotel Corridor** scene and drop some references into it.
6. Click Generate, add `[Venkatesh Character Sheet] + [Hotel Corridor]` as references.
7. Select Seedance, write the shot, Generate.
8. Receive three videos. Choose one, branch it, or use a frame from it as another reference.
9. For the next shot, drag that frame + the same character + a new environment into References.
10. Continue however they want.

There is **no predefined filmmaking pipeline**.

But the product makes that workflow incredibly comfortable.

---

# Outputs are immediately reusable

Every output card could have simple actions:

**Use as reference** · **Add to…** · **Branch** · **Compare** · **Open**

"Branch" could be fantastic.

You generate:

`shot-07-v1`

Then branch:

```text
shot-07-v1
    ├─ make camera slower
    ├─ change expression
    └─ Kling version
```

Now you automatically get provenance without exposing a graph.

And if someone wants to see it:

**View lineage**

opens:

```text
portrait.jpg ───────┐
                    ├── image-42 ─── video-53
hotel-reference ────┘             └─ video-56
```

That's really nice.

---

# Local-first becomes especially valuable here

Every API result should immediately become a local asset.

This isn't just philosophical. Replicate notes that API prediction inputs/outputs and associated files can be automatically deleted after an hour, so applications are expected to persist results they need. ([Replicate][6])

So when generation completes:

```text
/project
    /assets
    /characters
    /scenes
    /generations
```

The app downloads the result.

SQLite stores the relationships.

The cloud provider becomes **compute**, not storage.

That is exactly the local-first model I would want.

---

# And preserve model/version provenance

Every generated asset quietly remembers:

```text
provider: openrouter
model: bytedance/seedance...
version: ...
prompt: ...
inputs: [...]
parameters: {...}
created_at: ...
parent_generation: ...
```

Replicate explicitly versions models because model behavior changes, and versioning is what makes generations reproducible. ([Replicate][7])

You don't need to expose all of that normally.

Double-click → **Details**.

There it is.

---

# I think the guiding philosophy is now very clear

I'd make these the product rules:

* **Everything is an asset.**
* **Containers organize assets; they don't dictate workflows.**
* **Anything can reference anything.**
* **Models declare their capabilities.**
* **Never silently choose references or models for the user.**
* **AI assistance is explicit and optional.**
* **Simple controls first; native controls underneath.**
* **Every generation is reusable and branchable.**
* **Everything important lives locally.**
* **The user's intent and history survive model changes.**

And I think this is substantially more interesting than simply making an open-source Higgsfield clone.

It becomes something like:

> **A visual local workspace for generative media. Bring any models. Keep your characters, scenes, references and generations organized. Create however you want.**

That is a product I can see myself actually wanting to use for the Infinite Hotel project, because right now the painful part isn't necessarily generating a Seedance clip. It's **keeping 50 images, prompts, characters, previous generations, reference combinations, model settings, and scene continuity mentally organized while experimenting**. This workspace solves *that*.

[1]: https://openrouter.ai/blog/announcements/video-generation/?utm_source=chatgpt.com "Announcing Video Generation — OpenRouter Blog"
[2]: https://replicate.com/docs/reference/openapi?utm_source=chatgpt.com "OpenAPI schema - Replicate"
[3]: https://replicate.com/docs/topics/models/official-models?utm_source=chatgpt.com "Official models - Replicate"
[4]: https://replicate.com/runwayml/gen4-image/api/schema?utm_source=chatgpt.com "runwayml/gen4-image | Schema"
[5]: https://openrouter.ai/blog/announcements/image-api/?utm_source=chatgpt.com "Introducing the Unified Image API — OpenRouter Blog"
[6]: https://replicate.com/docs/topics/webhooks?utm_source=chatgpt.com "Webhooks - Replicate"
[7]: https://replicate.com/docs/topics/models/versions?utm_source=chatgpt.com "Model versions - Replicate"

