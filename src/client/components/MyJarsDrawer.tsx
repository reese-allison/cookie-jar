import { useEffect, useState } from "react";
import type { ActiveRoomSummary, OwnedJarWithRooms } from "../lib/myJarsApi";
import { fetchMyJars } from "../lib/myJarsApi";

interface MyJarsDrawerProps {
  open: boolean;
  onClose: () => void;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
}

export function MyJarsDrawer({ open, onClose, onJoinRoom, onCreateRoom }: MyJarsDrawerProps) {
  const [jars, setJars] = useState<OwnedJarWithRooms[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setJars(null);
    setError(null);
    fetchMyJars()
      .then((data) => {
        if (!cancelled) setJars(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your jars");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="my-jars-drawer" role="dialog" aria-label="My Jars">
      <div className="my-jars-drawer__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="my-jars-drawer__panel">
        <header className="my-jars-drawer__header">
          <h2>My Jars</h2>
          <button
            type="button"
            className="my-jars-drawer__close"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </header>

        {error && <p className="my-jars-drawer__error">{error}</p>}
        {!error && jars === null && <p className="my-jars-drawer__loading">Loading…</p>}
        {!error && jars?.length === 0 && (
          <p className="my-jars-drawer__empty">You haven't made any jars yet.</p>
        )}
        {!error && jars && jars.length > 0 && (
          <ul className="my-jars-drawer__list">
            {jars.map((jar) => (
              <JarRow key={jar.id} jar={jar} onJoinRoom={onJoinRoom} onCreateRoom={onCreateRoom} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function JarRow({
  jar,
  onJoinRoom,
  onCreateRoom,
}: {
  jar: OwnedJarWithRooms;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
}) {
  return (
    <li className="my-jars-drawer__jar">
      <div className="my-jars-drawer__jar-name">{jar.name}</div>
      {jar.activeRooms.length === 0 ? (
        <button
          type="button"
          className="my-jars-drawer__action"
          onClick={() => onCreateRoom(jar.id)}
        >
          New room
        </button>
      ) : (
        <ul className="my-jars-drawer__rooms">
          {jar.activeRooms.map((room: ActiveRoomSummary) => (
            <li key={room.code} className="my-jars-drawer__room">
              <code className="my-jars-drawer__code">{room.code}</code>
              <span className="my-jars-drawer__state">{room.state}</span>
              <button
                type="button"
                className="my-jars-drawer__action"
                onClick={() => onJoinRoom(room.code)}
              >
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
