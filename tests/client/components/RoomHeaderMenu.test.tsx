/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoomHeaderMenu } from "../../../src/client/components/RoomHeaderMenu";

afterEach(cleanup);

describe("RoomHeaderMenu", () => {
  it("shows the toggle button and hides children until opened", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
      </RoomHeaderMenu>,
    );
    expect(screen.getByRole("button", { name: /menu/i })).toBeDefined();
    expect(screen.queryByText("Leave")).toBeNull();
  });

  it("reveals children when toggled open", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
      </RoomHeaderMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByText("Leave")).toBeDefined();
  });

  it("closes on Escape", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
      </RoomHeaderMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByText("Leave")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Leave")).toBeNull();
  });

  it("closes when a child button inside the menu is clicked", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
      </RoomHeaderMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByText("Leave"));
    expect(screen.queryByText("Leave")).toBeNull();
  });

  it("toggle button reflects expanded state with aria-expanded", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
      </RoomHeaderMenu>,
    );
    const toggle = screen.getByRole("button", { name: /menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
