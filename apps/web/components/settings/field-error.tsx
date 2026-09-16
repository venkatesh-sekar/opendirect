"use client"

/**
 * The one way Settings reports a failed write.
 *
 * Three tabs had grown three treatments — a destructive `Alert`, and bare
 * `<p className="text-xs text-destructive">` in two places — and only one of
 * them was announced. A save that fails silently for a screen-reader user is
 * indistinguishable from one that worked, so this is `role="alert"` and every
 * site uses it.
 */
import { cn } from "@workspace/ui/lib/utils"

export interface FieldErrorProps {
  /** Nothing is rendered when there is no message, so callers can pass a maybe. */
  children?: string | null
  className?: string
}

export function FieldError({ children, className }: FieldErrorProps) {
  if (!children) return null
  return (
    <p role="alert" className={cn("text-xs text-destructive", className)}>
      {children}
    </p>
  )
}
