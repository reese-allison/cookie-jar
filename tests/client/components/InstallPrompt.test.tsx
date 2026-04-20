/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallPrompt } from "../../../src/client/components/InstallPrompt";

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  preventDefault: () => void;
};

function fireBeforeInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const e = new Event("beforeinstallprompt") as PromptEvent;
  e.prompt = vi.fn().mockResolvedValue(undefined);
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  (e as any).userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("InstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not render until beforeinstallprompt fires", () => {
    render(<InstallPrompt />);
    expect(screen.queryByText(/install/i)).toBeNull();
  });

  it("shows the banner once beforeinstallprompt fires", () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.getByRole("button", { name: /install/i })).toBeDefined();
  });

  it("hides after the user clicks Install", async () => {
    render(<InstallPrompt />);
    const evt = fireBeforeInstallPrompt("accepted");
    const btn = screen.getByRole("button", { name: /install/i });
    await act(async () => {
      fireEvent.click(btn);
      await evt.userChoice;
    });
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("respects the Not now dismissal and doesn't re-show on the next mount", () => {
    const { unmount } = render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    unmount();

    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
});
