/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../../../src/client/components/CopyButton";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

describe("CopyButton", () => {
  it("renders an accessible button using the given label", () => {
    render(<CopyButton value="hello" label="Copy note" />);
    expect(screen.getByRole("button", { name: /copy note/i })).toBeDefined();
  });

  it("writes the given value to the clipboard on click", () => {
    render(<CopyButton value="hello world" label="Copy note" />);
    fireEvent.click(screen.getByRole("button", { name: /copy note/i }));
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("calls onCopied after a successful copy", async () => {
    const onCopied = vi.fn();
    render(<CopyButton value="x" label="Copy note" onCopied={onCopied} />);
    fireEvent.click(screen.getByRole("button", { name: /copy note/i }));
    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
  });

  it("renders an icon (svg) rather than a visible text label, keeping the accessible name", () => {
    render(<CopyButton value="x" label="Copy note" />);
    const btn = screen.getByRole("button", { name: /copy note/i });
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent?.trim()).toBe("");
  });

  it("does not throw when the clipboard API is unavailable", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CopyButton value="x" label="Copy note" />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: /copy note/i }))).not.toThrow();
  });
});
