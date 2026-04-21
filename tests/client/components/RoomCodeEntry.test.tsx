/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomCodeEntry } from "../../../src/client/components/RoomCodeEntry";

afterEach(cleanup);

const baseProps = {
  onJoin: vi.fn(),
  isJoining: false,
  isCreating: false,
  error: null,
  user: null,
};

describe("RoomCodeEntry landing tabs", () => {
  it("defaults to the Join tab with the room code form visible", () => {
    render(<RoomCodeEntry {...baseProps} />);
    expect(screen.getByRole("textbox", { name: /room code/i })).toBeDefined();
    // Host-only controls should not be visible on the Join tab
    expect(screen.queryByPlaceholderText("Jar name")).toBeNull();
  });

  it("switches to the Host tab and points unauthed users to the top bar", () => {
    // Auth now lives in the universal TopBar, not inside this tab. The host
    // tab should only explain that signing in is required — no duplicate
    // provider buttons — and hide the Join form.
    render(<RoomCodeEntry {...baseProps} />);
    fireEvent.click(screen.getByRole("radio", { name: /host/i }));
    expect(screen.queryByRole("button", { name: /sign in with google/i })).toBeNull();
    expect(screen.getByText(/sign in.*host/i)).toBeDefined();
    expect(screen.queryByRole("textbox", { name: /room code/i })).toBeNull();
  });

  it("shows CreateJar and template browser on the Host tab when authed", () => {
    render(
      <RoomCodeEntry
        {...baseProps}
        user={{ displayName: "Alice" }}
        onCreateJar={vi.fn()}
        onCloneTemplate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /host/i }));
    expect(screen.getByPlaceholderText("Jar name")).toBeDefined();
    expect(screen.getByRole("button", { name: /browse templates/i })).toBeDefined();
  });

  it("submits the join form with uppercased code and display name", () => {
    const onJoin = vi.fn();
    render(<RoomCodeEntry {...baseProps} onJoin={onJoin} user={{ displayName: "Alice" }} />);
    fireEvent.change(screen.getByRole("textbox", { name: /room code/i }), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
    expect(onJoin).toHaveBeenCalledWith("ABC123", "Alice");
  });

  it("announces error messages to assistive tech via role=alert", () => {
    render(<RoomCodeEntry {...baseProps} error="Room not found" user={{ displayName: "Alice" }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Room not found");
  });
});
