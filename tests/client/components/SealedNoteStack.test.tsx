/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SealedNoteStack } from "../../../src/client/components/SealedNoteStack";

afterEach(cleanup);

describe("SealedNoteStack", () => {
  it("renders nothing when count is zero", () => {
    const { container } = render(<SealedNoteStack count={0} revealAt={3} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when count is negative", () => {
    const { container } = render(<SealedNoteStack count={-1} revealAt={3} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one card per drawn note", () => {
    const { container } = render(<SealedNoteStack count={3} revealAt={5} />);
    expect(container.querySelectorAll(".sealed-card")).toHaveLength(3);
  });

  it("defines the card art once and references it from every card via <use>", () => {
    // The decorative SVG is identical per card, so it's defined a single time
    // as a <symbol> and each card points at it — keeps the DOM node count flat
    // as the reveal threshold grows.
    const { container } = render(<SealedNoteStack count={4} revealAt={4} />);
    expect(container.querySelectorAll("symbol#sealed-card-art")).toHaveLength(1);
    const uses = container.querySelectorAll(".sealed-card use");
    expect(uses).toHaveLength(4);
    for (const u of uses) {
      expect(u.getAttribute("href")).toBe("#sealed-card-art");
    }
  });

  it("shows the count over the reveal threshold", () => {
    render(<SealedNoteStack count={2} revealAt={5} />);
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText(/of/i)).toBeDefined();
  });

  it("shows how many more pulls are needed before reveal", () => {
    render(<SealedNoteStack count={2} revealAt={5} />);
    expect(screen.getByText(/3 more to reveal/i)).toBeDefined();
  });

  it("omits the 'more to reveal' suffix once the threshold is met", () => {
    render(<SealedNoteStack count={5} revealAt={5} />);
    expect(screen.queryByText(/more to reveal/i)).toBeNull();
  });

  it("uses aria-live=polite so screen readers announce reveal progress", () => {
    const { container } = render(<SealedNoteStack count={1} revealAt={3} />);
    const root = container.querySelector(".sealed-stack");
    expect(root?.getAttribute("aria-live")).toBe("polite");
  });
});
