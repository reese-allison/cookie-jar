/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateJar } from "../../../src/client/components/CreateJar";

afterEach(cleanup);

describe("CreateJar component", () => {
  it("renders the form with a name input and create button", () => {
    render(<CreateJar onCreate={vi.fn()} isCreating={false} />);
    expect(screen.getByPlaceholderText("Jar name")).toBeDefined();
    expect(screen.getByRole("button", { name: /create/i })).toBeDefined();
  });

  it("calls onCreate with jar name when submitted", () => {
    const onCreate = vi.fn();
    render(<CreateJar onCreate={onCreate} isCreating={false} />);

    fireEvent.change(screen.getByPlaceholderText("Jar name"), {
      target: { value: "Movie Night" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(onCreate).toHaveBeenCalledWith("Movie Night");
  });

  it("disables form while creating", () => {
    render(<CreateJar onCreate={vi.fn()} isCreating={true} />);
    expect(screen.getByPlaceholderText("Jar name")).toBeDisabled();
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  it("disables submit when name is empty", () => {
    render(<CreateJar onCreate={vi.fn()} isCreating={false} />);
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});
