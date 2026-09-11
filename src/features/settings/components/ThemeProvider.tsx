import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { LOCAL_STORAGE_KEYS } from "@/constants";

function NativeThemeSync() {
  const { theme } = useTheme();

  useEffect(() => {
    const themeSource: "system" | "light" | "dark" =
      theme === "light" || theme === "dark" ? theme : "system";
    window.electron?.setNativeThemeSource?.(themeSource);
  }, [theme]);

  return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      disableTransitionOnChange
      storageKey={LOCAL_STORAGE_KEYS.THEME}
      {...props}
    >
      <NativeThemeSync />
      {children}
    </NextThemesProvider>
  );
}
