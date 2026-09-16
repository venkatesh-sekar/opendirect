"use client"

import { useWorkspaceContainerId } from "@/components/shell/app-shell"

import { Canvas } from "@/components/canvas/canvas"

/**
 * The canvas route. The shell around it — sidebar, status strip, drag context
 * — lives in the root layout, so this page is only the workspace itself and
 * the container the sidebar has selected for it.
 */
export default function Page() {
  const containerId = useWorkspaceContainerId()
  return <Canvas containerId={containerId} />
}
