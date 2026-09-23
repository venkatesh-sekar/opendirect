/**
 * Every TanStack Query key the app uses, in one object.
 *
 * Keys are hierarchical on purpose: invalidating `["assets"]` sweeps every
 * container's board, while `["assets", containerId]` refetches just the one the
 * user is looking at. A mutation therefore names the narrowest key it can and
 * the hierarchy takes care of the rest — which only works while every key is
 * built here rather than spelled out at each call site.
 */
/**
 * The slice of a list a key stands for. Both fields are part of the key: two
 * pages of the same container are different cache entries, and leaving `offset`
 * out would make page 2 overwrite page 1 under one key.
 */
export interface PageKey {
  limit?: number
  offset?: number
}

function page(options: PageKey | undefined) {
  return {
    limit: options?.limit ?? null,
    offset: options?.offset ?? null,
  }
}

export const queryKeys = {
  project: {
    current: ["project", "current"] as const,
    recent: ["project", "recent"] as const,
    all: ["project"] as const,
  },
  containers: {
    all: ["containers"] as const,
    tree: ["containers", "tree"] as const,
    /**
     * Under `containers` on purpose: every tree mutation invalidates
     * `containers.all`, and a rename, a new reference or a delete changes a
     * card as surely as it changes the tree.
     */
    summaries: ["containers", "summaries"] as const,
  },
  assets: {
    all: ["assets"] as const,
    byContainer: (containerId: string, options?: PageKey) =>
      ["assets", containerId, page(options)] as const,
    detail: (id: string) => ["assets", "detail", id] as const,
  },
  /**
   * The creation bar's live quote. The params are part of the key — a quote is
   * a function of them, and sharing one key across param sets would show the
   * price of the previous settings.
   */
  cost: {
    all: ["cost"] as const,
    estimate: (modelKey: string, params: unknown) =>
      ["cost", modelKey, params] as const,
  },
  /**
   * The job runner's queue. One key for the whole list: it is short, it is
   * pushed to rather than polled, and a per-job key would mean re-fetching the
   * list to find out which entry changed.
   */
  jobs: {
    all: ["jobs"] as const,
    list: ["jobs", "list"] as const,
  },
  /**
   * The visual canvas. One key for the whole surface: `canvas:get` returns
   * every node and edge in one go, because that is how it is rendered, and a
   * per-node key would mean re-fetching the surface to find out which node
   * changed.
   *
   * `all` is what a mutation invalidates — node, edge and pick writes all land
   * back in the same query.
   */
  canvas: {
    all: ["canvas"] as const,
    graph: ["canvas", "graph"] as const,
  },
  /**
   * The `@` picker's subject index. One key for the whole list: it is the
   * project's characters and scenes, it is small, and every mutation that can
   * change it (a rename, a handle, a new reference image) invalidates the
   * whole thing anyway.
   */
  mentions: {
    all: ["mentions"] as const,
    subjects: ["mentions", "subjects"] as const,
  },
  generations: {
    all: ["generations"] as const,
    byContainer: (containerId: string, options?: PageKey) =>
      ["generations", containerId, page(options)] as const,
    /** Every run in the open project, whatever it was filed under. */
    project: (options?: PageKey) =>
      ["generations", "project", page(options)] as const,
    detail: (id: string) => ["generations", "detail", id] as const,
    lineage: (id: string) => ["generations", "lineage", id] as const,
  },
} as const
