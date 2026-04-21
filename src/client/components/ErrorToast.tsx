import { useEffect } from "react";
import { useRoomStore } from "../stores/roomStore";

/**
 * Dismissable toast bound to `roomStore.error`. Renders at the App root so
 * errors fired from anywhere (RoomCodeEntry submit, MyJarsDrawer join,
 * socket `room:error`, `rate_limited`, `auth:expired`) are visible even when
 * the originating UI has already closed.
 *
 * Auto-dismisses after 6s. Manually dismissable via the close button.
 */
const AUTO_DISMISS_MS = 6_000;

export function ErrorToast() {
  const error = useRoomStore((s) => s.error);
  const setError = useRoomStore((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;

  return (
    <div className="error-toast" role="alert" aria-live="assertive">
      <span className="error-toast__text">{error}</span>
      <button
        type="button"
        className="error-toast__close"
        aria-label="Dismiss"
        onClick={() => setError(null)}
      >
        ×
      </button>
    </div>
  );
}
