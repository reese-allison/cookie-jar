import { useEffect } from "react";
import { useRoomStore } from "../stores/roomStore";

/**
 * Transient, non-error toast bound to `roomStore.notice` (e.g. "Copied!").
 * Sibling to ErrorToast but deliberately distinct: `role="status"` +
 * `aria-live="polite"` (announced without interrupting), no manual dismiss,
 * and a shorter auto-dismiss — success confirmations are brief and low-stakes.
 * Mounted at the App root so any component can confirm an action via
 * `setNotice(...)` without threading props.
 */
const AUTO_DISMISS_MS = 2_000;

export function NoticeToast() {
  const notice = useRoomStore((s) => s.notice);
  const setNotice = useRoomStore((s) => s.setNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  if (!notice) return null;

  return (
    <div className="notice-toast" role="status" aria-live="polite">
      <span className="notice-toast__text">{notice}</span>
    </div>
  );
}
