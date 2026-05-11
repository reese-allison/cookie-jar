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

// Selectors Ko-fi's overlay-widget injects into the body: the chat-popup
// wrapper, the floating Support-button wrapper, and the script-managed
// overlay root. Used together with `visible` to show/hide the whole widget
// without tearing it down — Ko-fi keeps internal refs to these nodes, so
// removing them mid-session breaks the next `draw()` call.
const KOFI_DOM_SELECTORS =
  '.floatingchat-container, [class^="floatingchat-"], [class^="kofi-"], [id^="kofi-widget-"]';

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

function setKofiVisible(visible: boolean) {
  for (const el of document.querySelectorAll<HTMLElement>(KOFI_DOM_SELECTORS)) {
    if (el.tagName === "SCRIPT") continue;
    el.style.display = visible ? "" : "none";
  }
}

interface KofiWidgetProps {
  /**
   * When false, hides the widget without tearing it down. The DOM nodes Ko-fi
   * injected stay in place so a subsequent `visible={true}` can just unhide
   * them — re-running `kofiWidgetOverlay.draw()` after the nodes were removed
   * crashes the widget (it caches refs to the now-detached elements).
   *
   * Mount the component once at the App root and toggle this rather than
   * conditionally rendering — that's what keeps the in-room view free of the
   * floating Support button without triggering Ko-fi's remount crash path.
   */
  visible: boolean;
}

export function KofiWidget({ visible }: KofiWidgetProps) {
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
    };
  }, []);

  // Show/hide as a side effect of the `visible` prop. Runs after each
  // render so a freshly-loaded widget (DOM not yet in the page) catches up
  // on the next mutation tick — the MutationObserver above re-titles
  // iframes too, but visibility is a static-DOM concern handled here.
  useEffect(() => {
    setKofiVisible(visible);
  });

  return null;
}
