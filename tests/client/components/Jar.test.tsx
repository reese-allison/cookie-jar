/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Jar } from "../../../src/client/components/Jar";

afterEach(cleanup);

describe("Jar component", () => {
  it("renders with a note count", () => {
    render(<Jar noteCount={5} isLocked={false} onPull={vi.fn()} />);
    expect(screen.getByText("5")).toBeDefined();
  });

  it("renders zero count", () => {
    render(<Jar noteCount={0} isLocked={false} onPull={vi.fn()} />);
    expect(screen.getByText("0")).toBeDefined();
  });

  it("calls onPull when clicked", () => {
    const onPull = vi.fn();
    render(<Jar noteCount={3} isLocked={false} onPull={onPull} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPull).toHaveBeenCalledOnce();
  });

  it("disables pull when locked", () => {
    const onPull = vi.fn();
    render(<Jar noteCount={3} isLocked={true} onPull={onPull} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("disables pull when jar is empty", () => {
    const onPull = vi.fn();
    render(<Jar noteCount={0} isLocked={false} onPull={onPull} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });
});
