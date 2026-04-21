import type { PullHistoryEntry } from "@shared/types";
import { useState } from "react";
import { useNoteStore } from "../stores/noteStore";

interface PullHistoryProps {
  entries: PullHistoryEntry[];
  onRefresh: () => void;
  onClear?: () => void;
}

export function PullHistory({ entries, onRefresh, onClear }: PullHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const historyDirty = useNoteStore((s) => s.historyDirty);

  return (
    <div className="pull-history">
      <button
        type="button"
        className="btn--ghost pull-history__toggle"
        aria-expanded={isOpen}
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          // Only refetch when there's new data since the last fetch. Without
          // this, rapid toggles hit the server's 1-per-5s history:get budget
          // and surface a "doing that too fast" error for what the user
          // perceives as a pure UI-state flip.
          if (nextOpen && historyDirty) onRefresh();
        }}
      >
        History {isOpen ? "^" : "v"}
      </button>

      {isOpen && (
        <div className="pull-history__panel">
          {entries.length === 0 ? (
            <p className="pull-history__empty">No pulls yet</p>
          ) : (
            <ul className="pull-history__list">
              {entries.map((entry) => (
                <li key={entry.id} className="pull-history__entry">
                  <span className="pull-history__text">{entry.noteText}</span>
                  <span className="pull-history__meta">
                    {entry.pulledBy} &middot; {new Date(entry.pulledAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {onClear && entries.length > 0 && (
            <button type="button" className="pull-history__clear" onClick={onClear}>
              Clear history
            </button>
          )}
        </div>
      )}
    </div>
  );
}
