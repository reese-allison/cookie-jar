/**
 * @vitest-environment jsdom
 *
 * The hamburger menu's "close on any button click" rule is right for
 * terminal actions (Leave, Star, Sound) but wrong for disclosure toggles
 * like PullHistory — tapping the toggle on mobile closed the menu and
 * unmounted the history panel before the user could read it. Opt-out is
 * an ancestor `[data-keep-menu-open]` wrapper.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoomHeaderMenu } from "../../../src/client/components/RoomHeaderMenu";

afterEach(cleanup);

describe("RoomHeaderMenu keep-open opt-out", () => {
  it("keeps the menu open when a button inside [data-keep-menu-open] is clicked", () => {
    render(
      <RoomHeaderMenu>
        <div data-keep-menu-open="">
          <button type="button">History</button>
        </div>
      </RoomHeaderMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByText("History")).toBeDefined();
    fireEvent.click(screen.getByText("History"));
    // Menu is still open; History button is still visible.
    expect(screen.getByText("History")).toBeDefined();
  });

  it("still closes on buttons outside the opt-out wrapper", () => {
    render(
      <RoomHeaderMenu>
        <button type="button">Leave</button>
        <div data-keep-menu-open="">
          <button type="button">History</button>
        </div>
      </RoomHeaderMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    fireEvent.click(screen.getByText("Leave"));
    expect(screen.queryByText("Leave")).toBeNull();
  });
});
