import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  // Electron ships no Node server: the renderer is a plain static SPA bundle.
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  // Electron serves from a custom protocol root; relative asset paths are required.
  assetPrefix: process.env.NODE_ENV === "production" ? "./" : undefined,
  trailingSlash: true,
}

export default nextConfig
