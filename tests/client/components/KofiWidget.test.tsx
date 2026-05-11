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

function makeKofiDom() {
  const popup = document.createElement("div");
  popup.className = "floatingchat-container";
  const buttonWrap = document.createElement("div");
  buttonWrap.className = "floatingchat-donatebutton-wrap-anim";
  const overlayRoot = document.createElement("div");
  overlayRoot.id = "kofi-widget-overlay";
  document.body.append(popup, buttonWrap, overlayRoot);
  return { popup, buttonWrap, overlayRoot };
}

afterEach(() => {
  cleanup();
  for (const s of document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`)) s.remove();
  for (const c of document.querySelectorAll(
    '.floatingchat-container, [class^="floatingchat-"], [id^="kofi-widget-"]',
  )) {
    c.remove();
  }
  delete window.kofiWidgetOverlay;
});

describe("KofiWidget", () => {
  it("renders nothing in the React tree", () => {
    const { container } = render(<KofiWidget visible={true} />);
    expect(container.innerHTML).toBe("");
  });

  it("appends the Ko-fi overlay script to the document", () => {
    render(<KofiWidget visible={true} />);
    const script = getScript();
    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
  });

  it("draws the floating-chat widget with the configured handle once the script loads", () => {
    const draw = vi.fn();
    render(<KofiWidget visible={true} />);
    fireScriptLoad(draw);
    expect(draw).toHaveBeenCalledTimes(1);
    const [handle, config] = draw.mock.calls[0];
    expect(handle).toBe("reeseallison");
    expect(config.type).toBe("floating-chat");
    expect(config["floating-chat.donateButton.text"]).toBe("Support");
  });

  it("hides the injected Ko-fi DOM when visible flips to false", () => {
    // Regression guard for the prior mount/unmount cycle: tearing the
    // widget down and rebuilding it via remount made `draw()` crash on a
    // stale internal ref. The new flow keeps the widget mounted at the App
    // root and toggles visibility, so the DOM stays in place.
    const { rerender } = render(<KofiWidget visible={true} />);
    fireScriptLoad(vi.fn());
    const { popup, buttonWrap, overlayRoot } = makeKofiDom();

    rerender(<KofiWidget visible={false} />);
    expect(popup.style.display).toBe("none");
    expect(buttonWrap.style.display).toBe("none");
    expect(overlayRoot.style.display).toBe("none");
  });

  it("restores visibility when visible flips back to true", () => {
    const { rerender } = render(<KofiWidget visible={true} />);
    fireScriptLoad(vi.fn());
    const { popup, buttonWrap } = makeKofiDom();
    rerender(<KofiWidget visible={false} />);
    rerender(<KofiWidget visible={true} />);
    expect(popup.style.display).toBe("");
    expect(buttonWrap.style.display).toBe("");
  });

  it("does not call draw() a second time when visible toggles (the crash path)", () => {
    // The original bug: `draw()` ran on first mount, the widget injected
    // DOM, the component unmounted on Landing→Room, we removed the DOM,
    // then Landing remounted and called `draw()` again. Ko-fi's internal
    // cache pointed at the now-detached nodes → setting innerHTML on null.
    // Switching to a visibility toggle means draw() runs exactly once
    // per session.
    const draw = vi.fn();
    const { rerender } = render(<KofiWidget visible={true} />);
    fireScriptLoad(draw);
    expect(draw).toHaveBeenCalledTimes(1);
    rerender(<KofiWidget visible={false} />);
    rerender(<KofiWidget visible={true} />);
    rerender(<KofiWidget visible={false} />);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("leaves the Ko-fi <script> tag in place on unmount", () => {
    const { unmount } = render(<KofiWidget visible={true} />);
    expect(getScript()).not.toBeNull();
    unmount();
    expect(getScript()).not.toBeNull();
  });

  it("adds a title to Ko-fi iframes for accessibility", () => {
    render(<KofiWidget visible={true} />);
    const iframe = document.createElement("iframe");
    iframe.src = "https://ko-fi.com/widget";
    document.body.appendChild(iframe);
    fireScriptLoad(vi.fn());
    expect(iframe.title).toBe("Ko-fi donation widget");
  });
});
