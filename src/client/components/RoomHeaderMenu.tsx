import { useEffect, useRef, useState } from "react";

interface RoomHeaderMenuProps {
  children: React.ReactNode;
}

export function RoomHeaderMenu({ children }: RoomHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  // Close when any button inside the menu is clicked — mirrors OS overflow
  // menus. Exception: anything under [data-keep-menu-open] is a nested
  // disclosure (e.g. PullHistory), where the button click should toggle that
  // sub-panel instead of collapsing the whole overflow menu.
  const onPanelClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-keep-menu-open]")) return;
    if (target.closest("button")) setOpen(false);
  };

  return (
    <div className="room-header-menu" ref={rootRef}>
      <button
        type="button"
        className="room-header-menu__toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 5h14a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2Zm0 4h14a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2Z"
          />
        </svg>
      </button>
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: escape + outside click handled in effect above
        <div className="room-header-menu__panel" role="menu" onClick={onPanelClick}>
          {children}
        </div>
      )}
    </div>
  );
}
