"use client"

/**
 * An asset's picture, sharp at whatever size it is on screen.
 *
 * Inside a canvas node the picture sits under React Flow's `scale(zoom)`, so a
 * fixed file is either a blurry magnified thumbnail (zoomed in) or a wasted
 * 12 MP decode (zoomed out). This picks a source from the asset's ladder —
 * thumbnail, 1024, 2048, original (see `lib/canvas/image-tiers.ts`) — from the
 * element's layout size × the viewport zoom × the display's pixel ratio, and:
 *
 * - **subscribes to the zoom in quarter-octave steps**, so a wheel gesture
 *   re-renders each image a few times, and never re-renders the node;
 * - **keeps the old picture up until the new one has decoded**, so a swap is
 *   a sharpening, never a flash of empty box;
 * - **waits for the zoom to settle** before fetching, so zooming from 0.5 to
 *   4 loads the file it ends on rather than every rung on the way;
 * - **only upgrades what is on screen** — the canvas unmounts off-screen nodes
 *   (`onlyRenderVisibleElements`) and an IntersectionObserver covers the rest;
 * - **steps back down when zoomed far out**, so an overview of many nodes does
 *   not hold one full-size bitmap per node.
 *
 * Outside a canvas (the asset library, container pages) the same rules apply
 * at zoom 1. Every other prop and the ref go to the `<img>`, so it still works
 * as a context-menu trigger's `render` element.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type Ref,
} from "react"
import type { AssetDto } from "@opendirect/contract"
import { useNodeId, useStore, type ReactFlowState } from "@xyflow/react"

import {
  chooseSource,
  imageSources,
  quantizeZoom,
  requiredEdge,
  type Size,
} from "@/lib/canvas/image-tiers"

/** How long the need must hold still before a different file is fetched. */
const SETTLE_MS = 150

const NO_FAILURES: ReadonlySet<string> = new Set()
const UNMEASURED: Size = { width: 0, height: 0 }

export type CanvasImageProps = Omit<ComponentProps<"img">, "src"> & {
  asset: Pick<AssetDto, "url" | "thumbnailUrl" | "width" | "height">
}

export function CanvasImage(props: CanvasImageProps) {
  // A node's id is only in context inside a React Flow node renderer, and that
  // is exactly where the viewport's zoom applies. `useStore` would throw
  // anywhere else, so the zoom-aware variant is only mounted there.
  return useNodeId() === null ? (
    <ResolutionAwareImage {...props} zoom={1} />
  ) : (
    <ZoomAwareImage {...props} />
  )
}

const selectZoomStep = (state: ReactFlowState) =>
  quantizeZoom(state.transform[2])

function ZoomAwareImage(props: CanvasImageProps) {
  const zoom = useStore(selectZoomStep)
  return <ResolutionAwareImage {...props} zoom={zoom} />
}

function ResolutionAwareImage({
  asset,
  zoom,
  ref,
  onError,
  ...imgProps
}: CanvasImageProps & { zoom: number }) {
  const { url, thumbnailUrl, width, height } = asset
  const sources = useMemo(
    () => imageSources({ url, thumbnailUrl, width, height }),
    [url, thumbnailUrl, width, height]
  )
  // A source that would not load (no tier on this host, an undecodable file)
  // is dropped from the ladder, so the next rung is tried instead.
  const [failed, setFailed] = useState(NO_FAILURES)
  const usable = useMemo(
    () => sources.filter((source) => !failed.has(source.url)),
    [sources, failed]
  )
  const markFailed = useCallback((source: string) => {
    setFailed((prev) => (prev.has(source) ? prev : new Set(prev).add(source)))
  }, [])

  const [element, setElement] = useState<HTMLImageElement | null>(null)
  const box = useElementSize(element)
  const visible = useIsVisible(element)
  const dpr = useDevicePixelRatio()

  // What is on screen: the last source that finished decoding, or the
  // smallest one until then (and whenever the asset itself changes).
  const [shown, setShown] = useState<string | null>(null)
  const displayed =
    usable.find((source) => source.url === shown)?.url ??
    usable[0]?.url ??
    url ??
    undefined

  const required = requiredEdge({
    box,
    intrinsic: width && height ? { width, height } : null,
    scale: zoom * dpr,
  })
  const target = visible
    ? (chooseSource(usable, required, displayed ?? null)?.url ?? displayed)
    : displayed

  useEffect(() => {
    if (!target || target === displayed) return
    let cancelled = false
    const preload = new Image()
    const timer = setTimeout(() => {
      preload.decoding = "async"
      preload.src = target
      decoded(preload).then(
        () => {
          if (!cancelled) setShown(target)
        },
        () => {
          if (!cancelled) markFailed(target)
        }
      )
    }, SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      // Stops a download nobody wants any more. Once the swap has happened
      // the on-screen <img> holds the decoded picture, not this element.
      preload.removeAttribute("src")
    }
  }, [target, displayed, markFailed])

  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      setElement(node)
      assignRef(ref, node)
    },
    [ref]
  )

  return (
    // A plain <img>: the app is a static export with `images.unoptimized`, so
    // next/image would add nothing, and the source ladder is chosen here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      loading="lazy"
      decoding="async"
      {...imgProps}
      ref={imgRef}
      src={displayed}
      data-source-edge={sources.find((s) => s.url === displayed)?.edge}
      onError={(event) => {
        if (displayed) markFailed(displayed)
        onError?.(event)
      }}
    />
  )
}

/** Resolves once `image` can be painted without a decode on the main thread. */
function decoded(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === "function") {
    return image.decode().catch((error: unknown) => {
      // `decode()` can reject for a picture that did load (Chromium does for
      // some very large ones); it will still paint, so that is not a failure.
      if (image.complete && image.naturalWidth > 0) return
      throw error
    })
  }
  return new Promise((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`Could not load ${image.src}`))
  })
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

/*
 * One ResizeObserver and one IntersectionObserver for every image, rather than
 * one each per image — a canvas can mount a few hundred of these.
 */

let sizeObserver: ResizeObserver | null = null
const sizeListeners = new WeakMap<Element, (size: Size) => void>()

/** The element's layout size in CSS pixels — untouched by the zoom transform. */
function useElementSize(element: Element | null): Size {
  const [size, setSize] = useState(UNMEASURED)
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return
    sizeObserver ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        sizeListeners.get(entry.target)?.({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        })
      }
    })
    sizeListeners.set(element, (next) =>
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      )
    )
    sizeObserver.observe(element)
    return () => {
      sizeListeners.delete(element)
      sizeObserver?.unobserve(element)
    }
  }, [element])
  return size
}

let visibilityObserver: IntersectionObserver | null = null
const visibilityListeners = new WeakMap<Element, (visible: boolean) => void>()

/**
 * Whether the element is on (or about to come on) screen. Without an
 * IntersectionObserver everything counts as visible.
 */
function useIsVisible(element: Element | null): boolean {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined"
  )
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return
    visibilityObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibilityListeners.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { rootMargin: "25%" }
    )
    visibilityListeners.set(element, setVisible)
    visibilityObserver.observe(element)
    return () => {
      visibilityListeners.delete(element)
      visibilityObserver?.unobserve(element)
    }
  }, [element])
  return visible
}

/*
 * `devicePixelRatio` changes when the window moves to another display and when
 * the page is zoomed (Electron's zoomFactor included), and neither fires an
 * event of its own; a `resolution` media query on the current value does.
 */
const dprListeners = new Set<() => void>()
let dprQuery: MediaQueryList | null = null

function onDprChange() {
  watchDpr()
  for (const listener of dprListeners) listener()
}

function watchDpr() {
  dprQuery?.removeEventListener("change", onDprChange)
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprQuery.addEventListener("change", onDprChange)
}

function subscribeDpr(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {}
  dprListeners.add(listener)
  if (dprListeners.size === 1) watchDpr()
  return () => {
    dprListeners.delete(listener)
    if (dprListeners.size === 0) {
      dprQuery?.removeEventListener("change", onDprChange)
      dprQuery = null
    }
  }
}

function useDevicePixelRatio(): number {
  return useSyncExternalStore(
    subscribeDpr,
    () => window.devicePixelRatio || 1,
    () => 1
  )
}
