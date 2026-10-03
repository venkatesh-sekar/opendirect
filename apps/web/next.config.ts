import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Both are workspace packages shipped as TypeScript source.
  transpilePackages: ["@workspace/ui", "@opendirect/contract"],
  // Electron ships no Node server: the renderer is a plain static SPA bundle.
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  // No assetPrefix: electron-serve serves the export at the `app://-/` root, so
  // Next's default absolute `/_next/…` URLs resolve from every route. A
  // relative prefix breaks chunk loads on nested routes like /characters/.
  trailingSlash: true,
}

export default nextConfig
