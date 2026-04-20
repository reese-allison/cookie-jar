/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteStylePicker } from "../../../src/client/components/NoteStylePicker";

describe("NoteStylePicker", () => {
  it("renders 5 style tiles", () => {
    render(<NoteStylePicker value="sticky" onChange={() => {}} />);
    const tiles = screen.getAllByRole("radio");
    expect(tiles).toHaveLength(5);
  });

  it("marks the selected style with aria-checked", () => {
    render(<NoteStylePicker value="parchment" onChange={() => {}} />);
    const selected = screen.getByRole("radio", { name: /parchment/i });
    expect(selected).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange when a tile is clicked", () => {
    const onChange = vi.fn();
    render(<NoteStylePicker value="sticky" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /napkin/i }));
    expect(onChange).toHaveBeenCalledWith("napkin");
  });

  it("moves selection on ArrowRight", () => {
    const onChange = vi.fn();
    render(<NoteStylePicker value="sticky" onChange={onChange} />);
    const selected = screen.getByRole("radio", { name: /sticky/i });
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("index_card");
  });

  it("wraps to the first tile on ArrowRight from the last", () => {
    const onChange = vi.fn();
    render(<NoteStylePicker value="fortune_cookie" onChange={onChange} />);
    const selected = screen.getByRole("radio", { name: /fortune/i });
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("sticky");
  });
});
