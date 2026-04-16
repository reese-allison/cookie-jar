/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiscardBin } from "../../../src/client/components/DiscardBin";

afterEach(cleanup);

describe("DiscardBin component", () => {
  it("renders with a label", () => {
    render(<DiscardBin isHighlighted={false} />);
    expect(screen.getByText("Discard")).toBeDefined();
  });

  it("applies highlight class when a note is dragged over it", () => {
    const { container } = render(<DiscardBin isHighlighted={true} />);
    const bin = container.querySelector(".discard-bin");
    expect(bin?.classList.contains("discard-bin--highlighted")).toBe(true);
  });

  it("does not apply highlight class by default", () => {
    const { container } = render(<DiscardBin isHighlighted={false} />);
    const bin = container.querySelector(".discard-bin");
    expect(bin?.classList.contains("discard-bin--highlighted")).toBe(false);
  });
});
