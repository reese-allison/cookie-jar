/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullHistory } from "../../../src/client/components/PullHistory";
import type { PullHistoryEntry } from "../../../src/shared/types";

afterEach(cleanup);

const entry = (id: string): PullHistoryEntry => ({
  id,
  noteText: `note ${id}`,
  pulledBy: "Alice",
  pulledAt: "2026-04-20T00:00:00Z",
});

describe("PullHistory component", () => {
  it("collapses by default, expands on click, and fetches entries once on open", () => {
    const onRefresh = vi.fn();
    render(<PullHistory entries={[]} onRefresh={onRefresh} />);
    // Panel is not rendered when collapsed.
    expect(screen.queryByText(/no pulls yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText(/no pulls yet/i)).toBeDefined();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders entries with text and metadata", () => {
    render(<PullHistory entries={[entry("1")]} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText("note 1")).toBeDefined();
    expect(screen.getByText(/Alice/)).toBeDefined();
  });

  it("clicking clear calls onClear directly (no confirm prompt)", () => {
    const onClear = vi.fn();
    render(<PullHistory entries={[entry("1")]} onRefresh={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear history/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
