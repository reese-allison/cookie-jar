/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BulkImportForm } from "../../../src/client/components/BulkImportForm";

function fillTextarea(textarea: HTMLElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe("BulkImportForm", () => {
  it("shows 0 ready when empty", () => {
    render(<BulkImportForm onSubmit={vi.fn()} />);
    expect(screen.getByText(/0 notes ready/i)).toBeTruthy();
  });

  it("counts non-empty trimmed lines", () => {
    render(<BulkImportForm onSubmit={vi.fn()} />);
    const ta = screen.getByRole("textbox");
    fillTextarea(ta, "one\n  \ntwo\nthree\n");
    expect(screen.getByText(/3 notes ready/i)).toBeTruthy();
  });

  it("disables submit when count is 0", () => {
    render(<BulkImportForm onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /import/i })).toHaveProperty("disabled", true);
  });

  it("disables submit and warns when over 500", () => {
    render(<BulkImportForm onSubmit={vi.fn()} />);
    const ta = screen.getByRole("textbox");
    const text = Array.from({ length: 501 }, (_, i) => `note ${i}`).join("\n");
    fillTextarea(ta, text);
    expect(screen.getByRole("button", { name: /import/i })).toHaveProperty("disabled", true);
    expect(screen.getByText(/over the 500 limit/i)).toBeTruthy();
  });

  it("calls onSubmit with trimmed non-empty lines", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<BulkImportForm onSubmit={onSubmit} />);
    const ta = screen.getByRole("textbox");
    fillTextarea(ta, "  first \nsecond \n\n third\n");
    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    expect(onSubmit).toHaveBeenCalledWith(["first", "second", "third"]);
  });
});
