/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteForm } from "../../../src/client/components/NoteForm";

afterEach(cleanup);

describe("NoteForm component", () => {
  it("renders the form with a text input and submit button", () => {
    render(<NoteForm onSubmit={vi.fn()} disabled={false} />);
    expect(screen.getByPlaceholderText(/Jot something down/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /add to jar/i })).toBeDefined();
  });

  it("calls onSubmit with note data when form is submitted", () => {
    const onSubmit = vi.fn();
    render(<NoteForm onSubmit={onSubmit} disabled={false} />);

    const textarea = screen.getByPlaceholderText(/Jot something down/i);
    fireEvent.change(textarea, { target: { value: "Go to the park" } });
    fireEvent.click(screen.getByRole("button", { name: /add to jar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      text: "Go to the park",
      style: "sticky",
    });
  });

  it("clears the form after submission", () => {
    const onSubmit = vi.fn();
    render(<NoteForm onSubmit={onSubmit} disabled={false} />);

    const textarea = screen.getByPlaceholderText(/Jot something down/i);
    fireEvent.change(textarea, { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: /add to jar/i }));

    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("disables submit when text is empty", () => {
    render(<NoteForm onSubmit={vi.fn()} disabled={false} />);
    const button = screen.getByRole("button", { name: /add to jar/i });
    expect(button).toBeDisabled();
  });

  it("disables the form when disabled prop is true", () => {
    render(<NoteForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByPlaceholderText(/Jot something down/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /add to jar/i })).toBeDisabled();
  });

  it("includes URL when provided", () => {
    const onSubmit = vi.fn();
    render(<NoteForm onSubmit={onSubmit} disabled={false} />);

    fireEvent.change(screen.getByPlaceholderText(/Jot something down/i), {
      target: { value: "Check this" },
    });
    fireEvent.change(screen.getByPlaceholderText("URL (optional)"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add to jar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      text: "Check this",
      url: "https://example.com",
      style: "sticky",
    });
  });
});
