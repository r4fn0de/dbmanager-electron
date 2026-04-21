import { cn } from "@/utils/tailwind";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useMemo, useRef } from "react";

type Direction = "forward" | "backward";

const StepperContext = createContext<{
  active: string;
  direction: Direction;
} | null>(null);

function useStepperContext() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error("Stepper compound components must be used within <Stepper>");
  return ctx;
}

/** Strong ease-out — starts fast, feels responsive. (easing.dev) */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

export function Stepper({
  active,
  steps,
  children,
}: {
  active: string;
  /** Ordered step identifiers — used to detect transition direction. If omitted, direction defaults to "forward". */
  steps?: string[];
  children: React.ReactNode;
}) {
  const prevActiveRef = useRef(active);

  // Detect direction by comparing step order
  const direction: Direction = (() => {
    if (!steps || steps.length === 0) return "forward";
    const prevIdx = steps.indexOf(prevActiveRef.current);
    const nextIdx = steps.indexOf(active);
    if (prevIdx === -1 || nextIdx === -1) return "forward";
    return nextIdx >= prevIdx ? "forward" : "backward";
  })();

  // Update ref after computing direction
  prevActiveRef.current = active;

  return (
    <StepperContext value={useMemo(() => ({ active, direction }), [active, direction])}>
      {children}
    </StepperContext>
  );
}

export function StepperList({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex mb-6 -mx-4 justify-between relative h-10 before:absolute before:-z-10 before:inset-0 before:top-1/2 before:-translate-y-1/2 before:h-0.5 before:w-full before:bg-linear-to-r before:from-transparent before:via-muted-foreground/25 before:to-transparent">
      {children}
    </div>
  );
}

export function StepperTrigger({
  children,
  value,
  number,
}: {
  children: React.ReactNode;
  value: string;
  number: number;
}) {
  const { active } = useStepperContext();
  const shouldReduceMotion = useReducedMotion();
  const popScale = shouldReduceMotion ? 1 : 1.08;

  return (
    <div className="flex items-center gap-3 bg-background px-4">
      <motion.div
        className={cn(
          "flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors",
          active === value
            ? "bg-primary text-primary-foreground border-transparent"
            : "bg-background text-muted-foreground border-border",
        )}
        // Emil: "Buttons must feel responsive" — tiny scale pop when becoming active
        // Full transform string for GPU compositing (same pattern as StepperContent)
        animate={{ transform: active === value ? `scale(${popScale})` : "scale(1)" }}
        transition={{ transform: { type: "spring", stiffness: 500, damping: 25 } }}
      >
        {number}
      </motion.div>
      <span
        className={cn(
          "text-sm font-medium transition-colors",
          active === value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * Wraps all StepperContent children in a shared AnimatePresence
 * with a layout-animated container that smoothly transitions height.
 *
 * Uses `mode="popLayout"` so the incoming step immediately occupies
 * layout space (preventing dialog height jumps), while the outgoing
 * step exits as a brief overlay. Subtle blur on exit masks the overlap,
 * making the crossfade feel like a single smooth transformation.
 */
export function StepperBody({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      transition={{ layout: { type: "spring", stiffness: 400, damping: 30 } }}
    >
      <AnimatePresence mode="popLayout">
        {children}
      </AnimatePresence>
    </motion.div>
  );
}

export function StepperContent({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const { active, direction } = useStepperContext();
  const shouldReduceMotion = useReducedMotion();

  if (active !== value) return null;

  // Slide direction — forward slides in from right, backward from left.
  // Reduced motion: skip spatial transforms, keep opacity for comprehension.
  const slideX = shouldReduceMotion ? 0 : (direction === "forward" ? 12 : -12);
  const enterScale = shouldReduceMotion ? 1 : 0.95;
  const exitScale = shouldReduceMotion ? 1 : 0.97;
  const exitBlur = shouldReduceMotion ? "blur(0px)" : "blur(2px)";

  // Use full `transform` strings instead of shorthand `x`/`scale` props.
  // Emil: "Framer Motion shorthand x/y/scale use rAF on the main thread.
  // Full transform strings are GPU-composited and stay smooth under load."
  return (
    <motion.div
      key={value}
      className="relative z-[1]"
      initial={{
        opacity: 0,
        transform: `translateX(${slideX}px) scale(${enterScale})`,
      }}
      animate={{
        opacity: 1,
        transform: "translateX(0px) scale(1)",
        filter: "blur(0px)",
      }}
      exit={{
        opacity: 0,
        transform: `translateX(0px) scale(${exitScale})`,
        filter: exitBlur,
      }}
      transition={{
        // Strong ease-out — starts fast, feels responsive (easing.dev)
        opacity: { duration: 0.15, ease: EASE_OUT },
        transform: { duration: 0.2, ease: EASE_OUT },
        // Blur resolves fast — exit is naturally quicker since transform has no slide
        filter: { duration: 0.1 },
      }}
    >
      {children}
    </motion.div>
  );
}
