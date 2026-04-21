/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDrawer } from "../../../src/client/hooks/useDrawer";

afterEach(cleanup);

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDrawer(ref, open, onClose);
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <div ref={ref} data-testid="drawer">
        <button type="button" data-testid="first">
          first
        </button>
        <button type="button" data-testid="last">
          last
        </button>
      </div>
    </div>
  );
}

describe("useDrawer", () => {
  it("calls onClose when Escape is pressed while open", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on Escape when closed", () => {
    const onClose = vi.fn();
    render(<Harness open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus inside the drawer when open", () => {
    const { getByTestId } = render(<Harness open={true} onClose={vi.fn()} />);
    // useDrawer delegates to useFocusTrap; confirm the composition actually fires.
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: " " });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the Escape listener when the drawer closes", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={true} onClose={onClose} />);
    rerender(<Harness open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
