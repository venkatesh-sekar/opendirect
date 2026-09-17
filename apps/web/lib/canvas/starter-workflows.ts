import { workflowSchema } from "@opendirect/contract"

export const starterWorkflows = [
  workflowSchema.parse({
    format: "opendirect-workflow",
    version: 1,
    name: "Character study",
    description:
      "Write a character brief and create a consistent portrait. Choose an image model before running.",
    nodes: [
      {
        id: "brief",
        type: "text",
        x: 0,
        y: 0,
        width: 300,
        height: 240,
        text: "Character brief: appearance, clothing, personality, and visual style. Replace this with your own description.",
        recipe: null,
      },
      {
        id: "portrait",
        type: "image_gen",
        x: 440,
        y: 0,
        width: 400,
        height: 400,
        text: null,
        recipe: {
          prompt:
            "Create a clear character portrait with consistent facial features, neutral lighting, and a simple background.",
          modelKey: null,
        },
      },
    ],
    edges: [
      { sourceNodeId: "brief", targetNodeId: "portrait", slotField: null },
    ],
  }),
  workflowSchema.parse({
    format: "opendirect-workflow",
    version: 1,
    name: "Scene to motion",
    description:
      "Create a scene image, then use it as the starting reference for a video. Choose compatible image and video models and review the reference input.",
    nodes: [
      {
        id: "scene",
        type: "image_gen",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        text: null,
        recipe: {
          prompt:
            "A cinematic establishing shot. Describe the location, time of day, lighting, and atmosphere here.",
          modelKey: null,
        },
      },
      {
        id: "motion",
        type: "video_gen",
        x: 540,
        y: 0,
        width: 400,
        height: 300,
        text: null,
        recipe: {
          prompt:
            "A slow, smooth camera push into the scene. Preserve the composition and lighting of the reference image.",
          modelKey: null,
        },
      },
    ],
    edges: [{ sourceNodeId: "scene", targetNodeId: "motion", slotField: null }],
  }),
]
