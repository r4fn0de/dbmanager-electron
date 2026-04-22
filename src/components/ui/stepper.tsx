import { Check } from "lucide-react";
import { cn } from "@/utils/tailwind";
import { motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useMemo, useRef } from "react";

type Direction = "forward" | "backward";

const StepperContext = createContext<{
  active: string;
  direction: Direction;
  steps?: string[];
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
    <StepperContext value={useMemo(() => ({ active, direction, steps }), [active, direction, steps])}>
      {children}
    </StepperContext>
  );
}

/**
 * Pipeline-style step list with animated progress bar.
 * Steps shown as compact pills connected by a track that fills as you advance.
 */
export function StepperList({ children }: { children: React.ReactNode }) {
  return (
    <div role="list" className="flex items-center gap-0 mb-5">
      {children}
    </div>
  );
}

export function StepperTrigger({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) {
  const { active, steps } = useStepperContext();
  const shouldReduceMotion = useReducedMotion();

  const stepIndex = steps?.indexOf(value) ?? 0;
  const activeIndex = steps?.indexOf(active) ?? 0;
  const isCompleted = stepIndex < activeIndex;
  const isCurrent = active === value;

  // Determine if this is the last step (no connector after it)
  const isLast = steps ? stepIndex === steps.length - 1 : false;

  return (
    <>
      <div
        role="listitem"
        aria-current={isCurrent ? "step" : undefined}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1",
          isCurrent && "bg-primary/8",
        )}
      >
        {/* Step indicator: check for completed, dot for current, ring for upcoming */}
        <motion.div
          className={cn(
            "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-200",
            isCompleted && "bg-primary/15 text-primary",
            isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary/25",
            !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
          )}
          animate={{
            transform: isCurrent && !shouldReduceMotion ? "scale(1.08)" : "scale(1)",
          }}
          transition={{ transform: { type: "spring", stiffness: 500, damping: 25 } }}
        >
          {isCompleted ? (
            <Check className="size-3" strokeWidth={2.5} />
          ) : (
            <span>{stepIndex + 1}</span>
          )}
        </motion.div>

        {/* Step label */}
        <span
          className={cn(
            "text-xs font-medium transition-colors duration-200 whitespace-nowrap",
            isCurrent && "text-foreground",
            isCompleted && "text-muted-foreground",
            !isCompleted && !isCurrent && "text-muted-foreground/60",
          )}
        >
          {children}
        </span>
      </div>

      {/* Connector line between steps */}
      {!isLast && (
        <div className="relative flex-1 min-w-[20px] h-px mx-1.5">
          {/* Background track */}
          <div className="absolute inset-0 bg-border rounded-full" />
          {/* Animated fill — fills up to the current step */}
          <motion.div
            className="absolute inset-y-0 left-0 bg-primary/40 rounded-full origin-left"
            initial={{ scaleX: 0 }}
            animate={{
              scaleX: isCompleted ? 1 : isCurrent ? 0.35 : 0,
            }}
            transition={{ scaleX: { duration: shouldReduceMotion ? 0 : 0.3, ease: EASE_OUT } }}
          />
        </div>
      )}
    </>
  );
}

/**
 * Smooth height container. Layout spring animates height when steps change.
 * No AnimatePresence — old step unmounts instantly, new step fades in.
 * This avoids overlap/ghosting from popLayout and looks clean (Linear-style).
 */
export function StepperBody({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      transition={{ layout: { type: "spring", stiffness: 500, damping: 35 } }}
    >
      {children}
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
  const { active } = useStepperContext();

  if (active !== value) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
