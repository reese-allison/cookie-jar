/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultJarSvg } from "../../../src/client/components/DefaultJarSvg";

afterEach(cleanup);

describe("DefaultJarSvg", () => {
  it("renders an aria-hidden svg with the default-jar-svg class", () => {
    const { container } = render(<DefaultJarSvg isOpen={false} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.classList.contains("default-jar-svg")).toBe(true);
  });

  it("seats the lid on the rim when closed", () => {
    // Translate-only, no rotation. The exact transform string is the visual
    // contract — if it changes, RoomView's lid animation expectations break.
    const { container } = render(<DefaultJarSvg isOpen={false} />);
    const lidGroup = container.querySelector("g[transform]");
    expect(lidGroup?.getAttribute("transform")).toBe("translate(100 58)");
  });

  it("lifts and tilts the lid when open", () => {
    // Open state shifts the lid right and rotates it 24deg.
    const { container } = render(<DefaultJarSvg isOpen={true} />);
    const lidGroup = container.querySelector("g[transform]");
    expect(lidGroup?.getAttribute("transform")).toBe("translate(138 54) rotate(24)");
  });
});
