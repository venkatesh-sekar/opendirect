// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import type { ContainerNodeDto } from "@opendirect/contract"

import {
  filingContainerId,
  forgetFilingContainer,
  lastFilingContainer,
  rememberFilingContainer,
} from "./filing"

function node(id: string, kind: ContainerNodeDto["kind"]): ContainerNodeDto {
  return {
    id,
    projectId: "p",
    parentId: null,
    kind,
    name: id,
    position: 0,
    handle: null,
    description: null,
    createdAt: 0,
    children: [],
  }
}

const TREE = [node("mira", "character"), node("hall", "scene")]

afterEach(() => forgetFilingContainer())

describe("where new canvas nodes are filed", () => {
  it("is the focused container when the canvas was opened on one", () => {
    rememberFilingContainer("hall")
    expect(filingContainerId(TREE, "mira")).toBe("mira")
  })

  /**
   * The sidebar picker is gone, so "the first container in the tree" would be
   * an arbitrary answer. The last container the user was actually looking at
   * is not.
   */
  it("is the container last visited when there is no focus", () => {
    rememberFilingContainer("hall")
    expect(lastFilingContainer()).toBe("hall")
    expect(filingContainerId(TREE, null)).toBe("hall")
  })

  it("survives a reload", () => {
    rememberFilingContainer("hall")
    // What a fresh window would read back.
    expect(window.localStorage.getItem("opendirect.filingContainer")).toBe(
      "hall"
    )
  })

  it("falls back to the first container when the remembered one is gone", () => {
    rememberFilingContainer("deleted")
    expect(filingContainerId(TREE, null)).toBe("mira")
    expect(filingContainerId(TREE, "also-deleted")).toBe("mira")
    expect(filingContainerId([], null)).toBeNull()
  })
})
