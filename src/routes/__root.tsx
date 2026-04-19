import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";

import { ThemeProvider } from "@/components/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/TitleBar";
import { Toaster } from "@/components/ui/sonner";

import "../styles/global.css";

function AnimatedOutlet() {
  const router = useRouter();
  const currentPath = router.state.location.pathname;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentPath}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="h-full"
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}

function Root() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased h-screen overflow-hidden">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <div className="h-screen flex flex-col overflow-hidden">
              {/* Custom TitleBar - System Aware */}
              <TitleBar />
              {/* Content area - ajusta baseado na plataforma */}
              <div className="flex-1 min-h-0 overflow-hidden relative bg-background/60">
                <div className="page-frame">
                  <AnimatedOutlet />
                </div>
              </div>
            </div>
          </TooltipProvider>
        </ThemeProvider>
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "DB Manager",
      },
    ],
    links: [],
  }),

  component: Root,
});
