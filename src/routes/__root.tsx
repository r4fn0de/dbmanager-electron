import {
  createRootRoute,
  Outlet,
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
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={currentPath}
        initial={{ x: 20 }}
        animate={{ x: 0 }}
        exit={{ x: -20 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="h-full"
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}

function Root() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <div className="h-screen flex flex-col overflow-hidden antialiased">
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
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export const Route = createRootRoute({
  component: Root,
});
