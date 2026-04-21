import { useId } from "react";

const GooeySvgFilter = ({
  id,
  strength = 10,
}: {
  id?: string;
  strength?: number;
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
        <filter id={filterId}>
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
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
};

export default GooeySvgFilter;
