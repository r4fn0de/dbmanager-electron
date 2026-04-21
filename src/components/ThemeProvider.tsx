import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { useTheme } from "next-themes";
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
      storageKey={LOCAL_STORAGE_KEYS.THEME}
      disableTransitionOnChange
      {...props}
    >
      <NativeThemeSync />
      {children}
    </NextThemesProvider>
  );
}
