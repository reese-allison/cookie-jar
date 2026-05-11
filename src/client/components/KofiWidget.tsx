import { useEffect } from "react";

const SCRIPT_ID = "kofi-widget-script";
const SCRIPT_SRC = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js";
const KOFI_HANDLE = "reeseallison";

const KOFI_BUTTON_CONFIG: Record<string, string> = {
  type: "floating-chat",
  "floating-chat.donateButton.text": "Support",
  "floating-chat.donateButton.background-color": "#323842",
  "floating-chat.donateButton.text-color": "#fff",
};

type KofiOverlay = { draw: (handle: string, config: Record<string, string>) => void };

declare global {
  interface Window {
    kofiWidgetOverlay?: KofiOverlay;
  }
}

function addTitlesToIframes() {
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe[src*="ko-fi"]')) {
    if (!iframe.title) iframe.title = "Ko-fi donation widget";
  }
}

export function KofiWidget() {
  useEffect(() => {
    const observer = new MutationObserver(addTitlesToIframes);
    observer.observe(document.body, { childList: true, subtree: true });

    const drawIfReady = () => {
      if (window.kofiWidgetOverlay) {
        window.kofiWidgetOverlay.draw(KOFI_HANDLE, KOFI_BUTTON_CONFIG);
      }
      addTitlesToIframes();
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      drawIfReady();
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = drawIfReady;
      document.body.appendChild(script);
    }

    return () => {
      observer.disconnect();
      // Ko-fi's overlay widget injects more than the chat container —
      // there's a separate floating Support button wrapper that survives a
      // `.floatingchat-container` removal. Tear down everything it owns so
      // the widget doesn't bleed into other screens (e.g. inside a room).
      for (const el of document.querySelectorAll(
        '.floatingchat-container, [class^="floatingchat-"], [class^="kofi-"], [id^="kofi-widget-"]',
      )) {
        // Don't yank the cached <script> tag — leaving it lets a future
        // remount re-draw without re-fetching from storage.ko-fi.com.
        if (el.tagName !== "SCRIPT") el.remove();
      }
    };
  }, []);

  return null;
}
