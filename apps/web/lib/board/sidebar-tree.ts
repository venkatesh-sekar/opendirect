/**
 * Turns the flat-ish container tree main hands us into the three fixed sidebar
 * sections the product asks for: Characters, Scenes, Assets.
 *
 * The sections are a *view*, not rows in the database. A container knows its
 * `kind`; the sidebar knows which heading a kind belongs under. Keeping that
 * mapping here — rather than inside the tree component — is what lets it be
 * tested without a DOM, and what stops four near-identical filters being
 * spelled out at three different call sites.
 *
 * A container of kind `project` is *transparent*: some projects have a single
 * root container wrapping everything, others file characters and scenes at the
 * top level. Hoisting a project node's children into the sections means both
 * shapes render identically.
 */
import type { ContainerKind, ContainerNodeDto } from "@opendirect/contract"

export type SidebarSectionId = "characters" | "scenes" | "assets"

export interface SidebarSection {
  id: SidebarSectionId
  label: string
  /** The kind a container created from this section's "New" action gets. */
  childKind: ContainerKind
  /** Root containers filed under this heading, in tree order. */
  nodes: ContainerNodeDto[]
}

const SECTION_FOR_KIND: Record<
  Exclude<ContainerKind, "project">,
  SidebarSectionId
> = {
  character: "characters",
  scene: "scenes",
  folder: "assets",
}

/** Section order is fixed; the product spells it out and users memorise it. */
export function buildSidebarSections(
  tree: ContainerNodeDto[]
): SidebarSection[] {
  const buckets: Record<SidebarSectionId, ContainerNodeDto[]> = {
    characters: [],
    scenes: [],
    assets: [],
  }

  const classify = (nodes: ContainerNodeDto[]): void => {
    for (const node of nodes) {
      if (node.kind === "project") {
        classify(node.children)
        continue
      }
      buckets[SECTION_FOR_KIND[node.kind]].push(node)
    }
  }
  classify(tree)

  return [
    {
      id: "characters",
      label: "Characters",
      childKind: "character",
      nodes: buckets.characters,
    },
    {
      id: "scenes",
      label: "Scenes",
      childKind: "scene",
      nodes: buckets.scenes,
    },
    {
      id: "assets",
      label: "Assets",
      childKind: "folder",
      nodes: buckets.assets,
    },
  ]
}

/** Depth-first lookup, so a rename or a delete can find what it selected. */
export function findContainer(
  tree: ContainerNodeDto[],
  id: string
): ContainerNodeDto | null {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findContainer(node.children, id)
    if (found) return found
  }
  return null
}

/** Every container, parents before children — used to pick a fallback board. */
export function flattenContainers(
  tree: ContainerNodeDto[]
): ContainerNodeDto[] {
  return tree.flatMap((node) => [node, ...flattenContainers(node.children)])
}

/**
 * The container the board should open on when nothing is selected yet: the
 * first real container in sidebar order, or null for an empty project.
 */
export function firstSelectableContainer(
  tree: ContainerNodeDto[]
): ContainerNodeDto | null {
  for (const section of buildSidebarSections(tree)) {
    const first = section.nodes[0]
    if (first) return first
  }
  return null
}
