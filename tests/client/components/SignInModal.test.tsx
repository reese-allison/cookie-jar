/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/lib/auth-client", () => ({
  IS_DEV: true,
  signIn: {
    social: vi.fn(),
    anonymous: vi.fn(),
  },
}));

import { SignInModal } from "../../../src/client/components/SignInModal";

afterEach(cleanup);

describe("SignInModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SignInModal open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders AuthButtons when open", () => {
    render(<SignInModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /sign in with discord/i })).toBeDefined();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<SignInModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<SignInModal open={true} onClose={onClose} />);
    const backdrop = container.querySelector(".sign-in-modal__backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the explicit Close button is clicked", () => {
    const onClose = vi.fn();
    render(<SignInModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
