import type { ComponentProps, ReactNode } from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider> & {
  children: ReactNode
}

export function ThemeProvider({
  children,
  attribute = "class",
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      storageKey={storageKey}
      disableTransitionOnChange={disableTransitionOnChange}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { useTheme }
