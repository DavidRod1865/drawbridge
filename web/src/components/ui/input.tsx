import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, onClick, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Date fields: hide the native calendar glyph and stretch its hit-target
        // across the input so a click anywhere opens the picker (Chromium/WebKit).
        type === "date" &&
          "relative cursor-pointer [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        // showPicker covers browsers where the indicator trick doesn't apply.
        if (type !== "date" || event.defaultPrevented) return
        try {
          event.currentTarget.showPicker?.()
        } catch {
          // Not supported, or the picker is already open from the same click.
        }
      }}
      {...props}
    />
  )
}

export { Input }
