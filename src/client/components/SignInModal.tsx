import { useRef } from "react";
import { useDrawer } from "../hooks/useDrawer";
import { AuthButtons } from "./AuthButtons";

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
}

export function SignInModal({ open, onClose }: SignInModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDrawer(panelRef, open, onClose);

  if (!open) return null;

  return (
    <div className="sign-in-modal" role="dialog" aria-label="Sign in" aria-modal="true">
      <div className="sign-in-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="sign-in-modal__panel">
        <header className="sign-in-modal__header">
          <h2>Sign in</h2>
          <button
            type="button"
            className="sign-in-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </header>
        <p className="sign-in-modal__note">
          Sign in to host jars, contribute notes, and keep your session across devices.
        </p>
        <AuthButtons />
      </div>
    </div>
  );
}
