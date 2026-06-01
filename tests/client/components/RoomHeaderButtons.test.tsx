/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsButton, StarToggleButton } from "../../../src/client/components/RoomHeaderButtons";

afterEach(cleanup);

describe("StarToggleButton", () => {
  it("labels itself 'Star this jar' and is not pressed when unstarred", () => {
    render(<StarToggleButton starred={false} onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: /star this jar/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("labels itself 'Unstar this jar' and is pressed when starred", () => {
    render(<StarToggleButton starred={true} onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: /unstar this jar/i });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("fires onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<StarToggleButton starred={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /star this jar/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsButton", () => {
  it("renders an accessible 'Jar settings' button and fires onClick", () => {
    const onClick = vi.fn();
    render(<SettingsButton onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /jar settings/i });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
