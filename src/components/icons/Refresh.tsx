import type { SVGProps } from "react";

export const Refresh = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    fill="none"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>Refresh</title>
    <path
      d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
    <path
      d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
);
