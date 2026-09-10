import { useId } from "react";

const GooeySvgFilter = ({
  id,
  strength = 10,
  borderColor,
  baseColor = "var(--background)",
}: {
  id?: string;
  strength?: number;
  /**
   * When set, draws a uniform 1px ring just inside the final gooey
   * silhouette (goo minus eroded goo), so the outline matches a plain CSS
   * border: same outer size, same thickness on curves and straights.
   * Pass `"var(--border)"` to match panels. The ring color is flattened
   * over `baseColor` (default `"var(--background)"`) so translucent border
   * colors render exactly like a border painted on that background, even
   * when the tab fill itself uses a different tint (e.g. `bg-sidebar`).
   */
  borderColor?: string;
  baseColor?: string;
}) => {
  const reactId = useId();
  const filterId = id ?? `gooey-filter-${reactId}`;
  const safeStrength =
    Number.isFinite(strength) && strength > 0 ? strength : 10;

  return (
    <svg
      className="absolute pointer-events-none"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute" }}
    >
      <defs>
        {/*
          sRGB (not the SVG default linearRGB) so flood/composite math for
          the border ring matches how CSS paints `border` on panels.
        */}
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={safeStrength}
            result="blur-sm"
          />
          <feColorMatrix
            in="blur-sm"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
            result="goo"
          />
          {borderColor ? (
            <>
              <feMorphology
                in="goo"
                operator="erode"
                radius="1"
                result="goo-eroded"
              />
              <feComposite
                in="goo"
                in2="goo-eroded"
                operator="out"
                result="goo-ring"
              />
              <feFlood
                style={{ floodColor: baseColor }}
                result="goo-base-color"
              />
              <feFlood
                style={{ floodColor: borderColor }}
                result="goo-ring-color"
              />
              <feComposite
                in="goo-ring-color"
                in2="goo-base-color"
                operator="over"
                result="goo-ring-flat"
              />
              <feComposite
                in="goo-ring-flat"
                in2="goo-ring"
                operator="in"
                result="goo-border"
              />
              <feComposite
                in="SourceGraphic"
                in2="goo"
                operator="atop"
                result="goo-base"
              />
              <feMerge>
                <feMergeNode in="goo-base" />
                <feMergeNode in="goo-border" />
              </feMerge>
            </>
          ) : (
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          )}
        </filter>
      </defs>
    </svg>
  );
};

export default GooeySvgFilter;
