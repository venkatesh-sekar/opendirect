import { Geist_Mono, Inter } from "next/font/google"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"

import { RENDERER_CSP } from "@/lib/csp"

import { ThemeProvider } from "@/components/theme-provider"

// The dev server needs eval and a websocket for HMR, so the locked-down policy
// is only emitted into production bundles — the ones Electron actually serves.
const csp = process.env.NODE_ENV === "production" ? RENDERER_CSP : undefined

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <head>
        {csp ? (
          <meta httpEquiv="Content-Security-Policy" content={csp} />
        ) : null}
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
