/**
 * Every TanStack Query key the app uses, in one object.
 *
 * Keys are hierarchical on purpose: invalidating `["assets"]` sweeps every
 * container's board, while `["assets", containerId]` refetches just the one the
 * user is looking at. A mutation therefore names the narrowest key it can and
 * the hierarchy takes care of the rest — which only works while every key is
 * built here rather than spelled out at each call site.
 */
export const queryKeys = {
  project: {
    current: ["project", "current"] as const,
    recent: ["project", "recent"] as const,
    all: ["project"] as const,
  },
  containers: {
    all: ["containers"] as const,
    tree: ["containers", "tree"] as const,
  },
  assets: {
    all: ["assets"] as const,
    byContainer: (containerId: string, page?: { limit?: number }) =>
      ["assets", containerId, page ?? null] as const,
    detail: (id: string) => ["assets", "detail", id] as const,
  },
  generations: {
    all: ["generations"] as const,
    byContainer: (containerId: string, page?: { limit?: number }) =>
      ["generations", containerId, page ?? null] as const,
    detail: (id: string) => ["generations", "detail", id] as const,
    lineage: (id: string) => ["generations", "lineage", id] as const,
  },
} as const
