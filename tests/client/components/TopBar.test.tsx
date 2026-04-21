/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../../../src/client/components/TopBar";

afterEach(cleanup);

describe("TopBar component", () => {
  it("renders the user's display name", () => {
    render(
      <TopBar
        user={{ displayName: "Alice", image: undefined }}
        onOpenMyJars={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("renders the avatar when an image is provided", () => {
    render(
      <TopBar
        user={{ displayName: "Alice", image: "https://example.com/a.png" }}
        onOpenMyJars={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    const avatar = screen.getByAltText("") as HTMLImageElement;
    expect(avatar.src).toBe("https://example.com/a.png");
  });

  it("invokes onOpenMyJars when the My Jars button is clicked", () => {
    const onOpenMyJars = vi.fn();
    render(
      <TopBar user={{ displayName: "Alice" }} onOpenMyJars={onOpenMyJars} onSignOut={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /my jars/i }));
    expect(onOpenMyJars).toHaveBeenCalled();
  });

  it("invokes onSignOut when the Sign out button is clicked", () => {
    const onSignOut = vi.fn();
    render(<TopBar user={{ displayName: "Alice" }} onOpenMyJars={vi.fn()} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("shows a Sign in button when user is null and calls onSignIn", () => {
    const onSignIn = vi.fn();
    render(<TopBar user={null} onSignIn={onSignIn} />);
    const btn = screen.getByRole("button", { name: /sign in/i });
    fireEvent.click(btn);
    expect(onSignIn).toHaveBeenCalled();
    // Signed-in-only controls must not leak into the signed-out state.
    expect(screen.queryByRole("button", { name: /my jars/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("still renders the brand when signed out", () => {
    render(<TopBar user={null} onSignIn={vi.fn()} />);
    expect(screen.getByText(/cookie jar/i)).toBeDefined();
  });
});
