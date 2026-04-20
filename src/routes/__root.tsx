import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";
import { TabbedConnectionView } from "@/components/TabbedConnectionView";

import "../styles/global.css";

function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDatabaseRoute = pathname.startsWith("/database/");

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider delay={500}>
        <div className="h-screen flex flex-col overflow-hidden antialiased">
          <TitleBar />
          <div className="flex-1 min-h-0 overflow-hidden bg-background/60">
            <div className="page-frame h-full">
              <div className={isDatabaseRoute ? "hidden" : "h-full"}>
                <Outlet />
              </div>
              <div className={isDatabaseRoute ? "h-full" : "hidden"}>
                <TabbedConnectionView />
              </div>
            </div>
          </div>
        </div>
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export const Route = createRootRoute({
  component: Root,
});
