import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReIcon } from "@/components/ui/ReIcon";

describe("ReIcon", () => {
  it("resolves a kebab-case name to a rendered Reicon glyph", () => {
    const { container } = render(<ReIcon name="database" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("reicon");
    expect(svg?.querySelector("path")).not.toBeNull();
  });

  it("defaults to 20px to match the app's existing icon sizing", () => {
    const { container } = render(<ReIcon name="plus" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
  });

  it("honours an explicit size prop", () => {
    const { container } = render(<ReIcon name="plus" size={32} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("derives the size from Tailwind spacing utilities", () => {
    const { container } = render(<ReIcon className="size-3.5" name="search" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("height", "14");
  });

  it("lets an explicit size prop win over the className", () => {
    const { container } = render(
      <ReIcon className="size-3" name="search" size={24} />
    );
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("width", "24");
  });

  it("forwards className, ARIA attributes and SVG props", () => {
    const { container } = render(
      <ReIcon
        aria-label="Warning"
        className="text-destructive"
        name="triangle-alert"
        role="img"
      />
    );
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("reicon", "text-destructive");
    expect(svg).toHaveAttribute("aria-label", "Warning");
    expect(svg).toHaveAttribute("role", "img");
  });

  it("inherits currentColor so Tailwind text utilities apply", () => {
    const { container } = render(<ReIcon name="star" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.innerHTML).toContain("currentColor");
  });

  it("renders a distinct glyph for the Filled weight", () => {
    const { container: outline } = render(<ReIcon name="star" />);
    const { container: filled } = render(
      <ReIcon name="star" weight="Filled" />
    );

    expect(outline.innerHTML).not.toBe(filled.innerHTML);
  });

  it("maps different names to different glyphs", () => {
    const { container: play } = render(<ReIcon name="play" />);
    const { container: pause } = render(<ReIcon name="pause" />);

    expect(play.innerHTML).not.toBe(pause.innerHTML);
  });
});
