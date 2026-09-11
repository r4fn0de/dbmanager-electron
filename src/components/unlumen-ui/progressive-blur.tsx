"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProgressiveBlurSide = "top" | "bottom" | "left" | "right";

export interface ProgressiveBlurProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  /** Which edge the blur is strongest at. @default "bottom" */
  side?: ProgressiveBlurSide;
  /** Thickness of the blurred area. @default "160px" */
  size?: string | number;
  /** Blur amount in pixels. @default 4 */
  strength?: number;
  /** Add a background-color tint fade alongside the blur. @default true */
  tint?: boolean;
  /** Opacity of the tint at the solid edge (0–1). @default 1 */
  tintStrength?: number;
}

// ─── Module-level constants ───────────────────────────────────────────────────

const IS_HORIZONTAL: Record<ProgressiveBlurSide, boolean> = {
  bottom: false,
  left: true,
  right: true,
  top: false,
};

// Gradient goes FROM the edge (opaque) TO the content (transparent)
const FADE_DIR: Record<ProgressiveBlurSide, string> = {
  bottom: "to top",
  left: "to right",
  right: "to left",
  top: "to bottom",
};

const POSITION_STYLE: Record<ProgressiveBlurSide, React.CSSProperties> = {
  bottom: { bottom: 0, left: 0 },
  left: { left: 0, top: 0 },
  right: { right: 0, top: 0 },
  top: { left: 0, top: 0 },
};

// ─── Component ───────────────────────────────────────────────────────────────

export const ProgressiveBlur = React.memo(
  function ProgressiveBlur({
    side = "bottom",
    strength = 4,
    size = "160px",
    tint = true,
    tintStrength = 1,
    className,
    style,
    ...props
  }: ProgressiveBlurProps) {
    const isHorizontal = IS_HORIZONTAL[side];
    const fadeDir = FADE_DIR[side];
    const sizeValue = typeof size === "number" ? `${size}px` : size;

    const sizeStyle: React.CSSProperties = isHorizontal
      ? { height: "100%", width: sizeValue }
      : { height: sizeValue, width: "100%" };

    const maskImage = `linear-gradient(${fadeDir}, black 50%, transparent 100%)`;

    const background = tint
      ? `linear-gradient(${fadeDir}, color-mix(in oklch, var(--background) ${Math.round(tintStrength * 100)}%, transparent) 0%, transparent 100%)`
      : undefined;

    return (
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute z-10", className)}
        style={{
          ...sizeStyle,
          ...POSITION_STYLE[side],
          backdropFilter: `blur(${strength}px)`,
          background,
          maskImage,
          WebkitBackdropFilter: `blur(${strength}px)`,
          WebkitMaskImage: maskImage,
          willChange: "backdrop-filter",
          ...style,
        }}
        {...props}
      />
    );
  },
  (prev, next) =>
    prev.side === next.side &&
    prev.strength === next.strength &&
    prev.size === next.size &&
    prev.tint === next.tint &&
    prev.tintStrength === next.tintStrength &&
    prev.className === next.className
);
