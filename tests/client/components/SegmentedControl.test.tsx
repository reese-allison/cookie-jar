/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../../../src/client/components/SegmentedControl";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry" },
] as const;

type V = (typeof OPTIONS)[number]["value"];

function renderControl(props: Partial<React.ComponentProps<typeof SegmentedControl<V>>> = {}) {
  return render(
    <SegmentedControl
      label="Fruit"
      value={props.value ?? "a"}
      options={[...OPTIONS]}
      onChange={props.onChange ?? vi.fn()}
      disabled={props.disabled}
    />,
  );
}

describe("SegmentedControl", () => {
  it("renders a labelled radiogroup", () => {
    renderControl();
    const group = screen.getByRole("radiogroup", { name: "Fruit" });
    expect(group).toBeDefined();
  });

  it("marks the selected option with aria-checked=true", () => {
    renderControl({ value: "b" });
    const banana = screen.getByRole("radio", { name: "Banana" });
    expect(banana.getAttribute("aria-checked")).toBe("true");
    const apple = screen.getByRole("radio", { name: "Apple" });
    expect(apple.getAttribute("aria-checked")).toBe("false");
  });

  it("only the selected option is in the tab order (roving tabindex)", () => {
    renderControl({ value: "b" });
    expect(screen.getByRole("radio", { name: "Apple" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "Banana" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: "Cherry" }).getAttribute("tabindex")).toBe("-1");
  });

  it("calls onChange when an option is clicked", () => {
    const onChange = vi.fn();
    renderControl({ value: "a", onChange });
    fireEvent.click(screen.getByRole("radio", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("ArrowRight moves selection to the next option", () => {
    const onChange = vi.fn();
    renderControl({ value: "a", onChange });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Apple" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ArrowLeft from the first option wraps to the last", () => {
    const onChange = vi.fn();
    renderControl({ value: "a", onChange });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Apple" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("ArrowDown also advances (vertical layouts)", () => {
    const onChange = vi.fn();
    renderControl({ value: "b", onChange });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Banana" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("disables every option when the control is disabled", () => {
    renderControl({ disabled: true });
    for (const opt of OPTIONS) {
      expect((screen.getByRole("radio", { name: opt.label }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });
});
