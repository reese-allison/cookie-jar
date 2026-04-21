/**
 * @vitest-environment jsdom
 *
 * Regression guard: SoundToggle composes the shared .btn--icon primitive
 * rather than a bespoke .sound-toggle size rule. If a future refactor drops
 * the .btn--icon class from the button, the icon would collapse to default
 * text-button dimensions. We verify the primitive class is applied and that
 * the sizing sticks even when nested inside .room-actions.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/lib/sounds", () => ({
  soundManager: {
    isEnabled: () => true,
    setEnabled: vi.fn(),
    play: vi.fn(),
  },
}));

import { SoundToggle } from "../../../src/client/components/SoundToggle";

afterEach(cleanup);

describe("SoundToggle icon rendering", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    const style = document.createElement("style");
    // Inline the .btn--icon primitive — if the component forgets to compose it,
    // the width/height assertions below will fail.
    style.textContent = `
      .btn--icon {
        width: 36px; height: 36px; padding: 0;
      }
    `;
    document.head.appendChild(style);
  });

  it("composes .btn--icon so the 36px circle size is explicit", () => {
    const host = document.createElement("div");
    host.className = "room-actions";
    document.body.appendChild(host);
    render(<SoundToggle />, { container: host });

    const btn = screen.getByRole("button", { name: /mute sounds/i });
    expect(btn.classList.contains("btn--icon")).toBe(true);
    const cs = getComputedStyle(btn);
    expect(cs.padding).toBe("0px");
    expect(cs.width).toBe("36px");
    expect(cs.height).toBe("36px");
  });
});
