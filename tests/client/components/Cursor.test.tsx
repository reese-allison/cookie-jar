/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Cursor } from "../../../src/client/components/Cursor";

afterEach(cleanup);

describe("Cursor component", () => {
  it("is wrapped in React.memo so peer cursor updates don't re-render every cursor", () => {
    // React.memo components expose a specific $$typeof symbol. Checking it
    // ensures we don't accidentally drop the memoization wrapper.
    expect((Cursor as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("renders with the user's display name", () => {
    render(<Cursor x={100} y={200} displayName="Alice" color="#FF6B6B" />);
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("positions at the given coordinates", () => {
    const { container } = render(<Cursor x={150} y={250} displayName="Bob" color="#4ECDC4" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.left).toBe("150px");
    expect(el.style.top).toBe("250px");
  });

  it("applies the user's color to the name label", () => {
    render(<Cursor x={0} y={0} displayName="Carol" color="#45B7D1" />);
    const label = screen.getByText("Carol");
    expect(label.style.backgroundColor).toBe("rgb(69, 183, 209)");
  });
});
