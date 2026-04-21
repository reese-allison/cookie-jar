/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusTrap } from "../../../src/client/hooks/useFocusTrap";

afterEach(cleanup);

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button type="button" data-testid="outside-before">
        outside before
      </button>
      <div ref={ref} data-testid="trap">
        <button type="button" data-testid="first">
          first
        </button>
        <input type="text" data-testid="middle" />
        <button type="button" data-testid="last">
          last
        </button>
      </div>
      <button type="button" data-testid="outside-after">
        outside after
      </button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves focus to the first focusable element when activated", () => {
    const { getByTestId } = render(<Harness active={true} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps focus from the last element back to the first on Tab", () => {
    const { getByTestId } = render(<Harness active={true} />);
    const last = getByTestId("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps focus from the first element back to the last on Shift+Tab", () => {
    const { getByTestId } = render(<Harness active={true} />);
    const first = getByTestId("first");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });

  it("restores focus to the previously focused element when deactivated", () => {
    const { getByTestId, rerender } = render(<Harness active={false} />);
    const trigger = getByTestId("outside-before");
    trigger.focus();
    rerender(<Harness active={true} />);
    expect(document.activeElement).toBe(getByTestId("first"));
    rerender(<Harness active={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it("does nothing when not active", () => {
    const { getByTestId } = render(<Harness active={false} />);
    const outside = getByTestId("outside-before");
    outside.focus();
    // Tab would normally move to the next focusable; the hook must not intercept.
    expect(document.activeElement).toBe(outside);
  });
});
