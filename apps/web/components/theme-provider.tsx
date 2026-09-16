"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * The theme, and nothing else.
 *
 * There used to be a global `keydown` listener here that toggled dark mode on
 * an unmodified `d`. It was undiscoverable, it was the only theme control in
 * the app, and on the canvas — a surface built around bare keystrokes — it
 * fired by accident. The control now lives where a user would look for it:
 * Settings → General → Appearance.
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
