import { useCallback, useEffect, useRef, useState } from "react";
import { useDrawer } from "../hooks/useDrawer";
import type {
  ActiveRoomSummary,
  MyJarsPayload,
  OwnedJarWithRooms,
  StarredJarWithAccess,
} from "../lib/myJarsApi";
import { deleteJar, fetchMyJars, unstarJar } from "../lib/myJarsApi";

interface MyJarsDrawerProps {
  open: boolean;
  onClose: () => void;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
}

export function MyJarsDrawer({ open, onClose, onJoinRoom, onCreateRoom }: MyJarsDrawerProps) {
  const [data, setData] = useState<MyJarsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useDrawer(panelRef, open, onClose);

  // Only refetch when we actually need fresh data. Closing and reopening the
  // drawer shouldn't hit the server (and shouldn't flash "Loading…" over
  // cached data we could already render). The cache is invalidated by any of
  // the mutations below; server-side changes from other tabs aren't reflected
  // until a page reload — acceptable since this drawer is a management view.
  useEffect(() => {
    if (!open || data !== null) return;
    let cancelled = false;
    fetchMyJars()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your jars");
      });
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  const handleDelete = useCallback(async (jarId: string, jarName: string) => {
    // window.confirm is intentionally blocking — destroying a jar cascades
    // every note, room, and history row. A toast-style undo isn't appropriate
    // for an owner-only destructive action.
    if (!window.confirm(`Delete "${jarName}"? Notes and rooms are permanently removed.`)) return;
    try {
      await deleteJar(jarId);
      setData((prev) =>
        prev ? { ...prev, ownedJars: prev.ownedJars.filter((j) => j.id !== jarId) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete jar");
    }
  }, []);

  const handleUnstar = useCallback(async (jarId: string) => {
    try {
      await unstarJar(jarId);
      setData((prev) =>
        prev ? { ...prev, starredJars: prev.starredJars.filter((j) => j.id !== jarId) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unstar jar");
    }
  }, []);

  if (!open) return null;

  const ownedJars = data?.ownedJars ?? [];
  const starredJars = data?.starredJars ?? [];
  const hasContent = ownedJars.length > 0 || starredJars.length > 0;

  return (
    <div className="my-jars-drawer" role="dialog" aria-label="My Jars">
      <div className="my-jars-drawer__backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="my-jars-drawer__panel">
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
        {!error && data === null && <p className="my-jars-drawer__loading">Loading…</p>}
        {!error && data !== null && !hasContent && (
          <p className="my-jars-drawer__empty">You haven't made or starred any jars yet.</p>
        )}

        {ownedJars.length > 0 && (
          <section className="my-jars-drawer__section">
            <h3 className="my-jars-drawer__section-title">Yours</h3>
            <ul className="my-jars-drawer__list">
              {ownedJars.map((jar) => (
                <OwnedJarRow
                  key={jar.id}
                  jar={jar}
                  onJoinRoom={onJoinRoom}
                  onCreateRoom={onCreateRoom}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </section>
        )}

        {starredJars.length > 0 && (
          <section className="my-jars-drawer__section">
            <h3 className="my-jars-drawer__section-title">Starred</h3>
            <ul className="my-jars-drawer__list">
              {starredJars.map((jar) => (
                <StarredJarRow
                  key={jar.id}
                  jar={jar}
                  onJoinRoom={onJoinRoom}
                  onCreateRoom={onCreateRoom}
                  onUnstar={handleUnstar}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OwnedJarRow({
  jar,
  onJoinRoom,
  onCreateRoom,
  onDelete,
}: {
  jar: OwnedJarWithRooms;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
  onDelete: (jarId: string, jarName: string) => void;
}) {
  return (
    <li className="my-jars-drawer__jar">
      <div className="my-jars-drawer__jar-header">
        <div className="my-jars-drawer__jar-name">{jar.name}</div>
        <button
          type="button"
          className="my-jars-drawer__delete"
          onClick={() => onDelete(jar.id, jar.name)}
          aria-label={`Delete ${jar.name}`}
          title="Delete jar"
        >
          Delete
        </button>
      </div>
      <RoomActions
        jarId={jar.id}
        activeRooms={jar.activeRooms}
        onJoinRoom={onJoinRoom}
        onCreateRoom={onCreateRoom}
      />
    </li>
  );
}

function StarredJarRow({
  jar,
  onJoinRoom,
  onCreateRoom,
  onUnstar,
}: {
  jar: StarredJarWithAccess;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
  onUnstar: (jarId: string) => void;
}) {
  return (
    <li className="my-jars-drawer__jar">
      <div className="my-jars-drawer__jar-header">
        <div className="my-jars-drawer__jar-name">{jar.name}</div>
        <button
          type="button"
          className="my-jars-drawer__delete"
          onClick={() => onUnstar(jar.id)}
          aria-label={`Unstar ${jar.name}`}
          title="Remove from My Jars"
        >
          Unstar
        </button>
      </div>
      {jar.hasAccess ? (
        <RoomActions
          jarId={jar.id}
          activeRooms={jar.activeRooms}
          onJoinRoom={onJoinRoom}
          onCreateRoom={onCreateRoom}
        />
      ) : (
        <p className="my-jars-drawer__no-access">
          The owner has removed your access. Unstar to remove it from this list.
        </p>
      )}
    </li>
  );
}

function RoomActions({
  jarId,
  activeRooms,
  onJoinRoom,
  onCreateRoom,
}: {
  jarId: string;
  activeRooms: ActiveRoomSummary[];
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
}) {
  if (activeRooms.length === 0) {
    return (
      <button type="button" className="my-jars-drawer__action" onClick={() => onCreateRoom(jarId)}>
        New room
      </button>
    );
  }
  return (
    <ul className="my-jars-drawer__rooms">
      {activeRooms.map((room) => (
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
  );
}
