/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KofiWidget } from "../../../src/client/components/KofiWidget";

type KofiOverlay = { draw: (handle: string, config: Record<string, string>) => void };

declare global {
  interface Window {
    kofiWidgetOverlay?: KofiOverlay;
  }
}

const SCRIPT_SRC = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js";

function getScript() {
  return document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
}

function fireScriptLoad(draw: KofiOverlay["draw"]) {
  window.kofiWidgetOverlay = { draw };
  const script = getScript();
  if (!script) throw new Error("Ko-fi script tag not found");
  script.dispatchEvent(new Event("load"));
}

afterEach(() => {
  cleanup();
  for (const s of document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`)) s.remove();
  for (const c of document.querySelectorAll(".floatingchat-container")) c.remove();
  delete window.kofiWidgetOverlay;
});

describe("KofiWidget", () => {
  it("renders nothing in the React tree", () => {
    const { container } = render(<KofiWidget />);
    expect(container.innerHTML).toBe("");
  });

  it("appends the Ko-fi overlay script to the document", () => {
    render(<KofiWidget />);
    const script = getScript();
    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
  });

  it("draws the floating-chat widget with the configured handle once the script loads", () => {
    const draw = vi.fn();
    render(<KofiWidget />);
    fireScriptLoad(draw);
    expect(draw).toHaveBeenCalledTimes(1);
    const [handle, config] = draw.mock.calls[0];
    expect(handle).toBe("reeseallison");
    expect(config.type).toBe("floating-chat");
    expect(config["floating-chat.donateButton.text"]).toBe("Support");
  });

  it("does not double-append the script when remounted", () => {
    const { unmount } = render(<KofiWidget />);
    unmount();
    render(<KofiWidget />);
    const scripts = document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`);
    expect(scripts.length).toBe(1);
  });

  it("re-draws when remounted after the script is already cached", () => {
    const draw = vi.fn();
    const { unmount } = render(<KofiWidget />);
    fireScriptLoad(draw);
    unmount();
    render(<KofiWidget />);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("removes every Ko-fi DOM element on unmount (button wrapper + popup container)", () => {
    // Regression guard: the widget previously only swept .floatingchat-container,
    // leaving the separate Support-button wrapper behind. The button then
    // bled through to other screens (e.g. inside a room) on remount.
    const { unmount } = render(<KofiWidget />);
    const popup = document.createElement("div");
    popup.className = "floatingchat-container";
    const buttonWrap = document.createElement("div");
    buttonWrap.className = "floatingchat-donatebutton-wrap-anim";
    const overlayRoot = document.createElement("div");
    overlayRoot.id = "kofi-widget-overlay";
    document.body.append(popup, buttonWrap, overlayRoot);
    unmount();
    expect(document.querySelector(".floatingchat-container")).toBeNull();
    expect(document.querySelector(".floatingchat-donatebutton-wrap-anim")).toBeNull();
    expect(document.getElementById("kofi-widget-overlay")).toBeNull();
  });

  it("leaves the Ko-fi <script> tag in place on unmount so a remount can reuse it", () => {
    // The cached script avoids re-fetching from storage.ko-fi.com when the
    // user bounces between Landing and a room.
    const { unmount } = render(<KofiWidget />);
    expect(getScript()).not.toBeNull();
    unmount();
    expect(getScript()).not.toBeNull();
  });

  it("adds a title to Ko-fi iframes for accessibility", () => {
    render(<KofiWidget />);
    const iframe = document.createElement("iframe");
    iframe.src = "https://ko-fi.com/widget";
    document.body.appendChild(iframe);
    fireScriptLoad(vi.fn());
    expect(iframe.title).toBe("Ko-fi donation widget");
  });
});
