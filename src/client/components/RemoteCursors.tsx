import type { RoomMember } from "@shared/types";
import { memo, type ReactElement, useMemo } from "react";
import { useRoomStore } from "../stores/roomStore";
import { Cursor } from "./Cursor";

interface RemoteCursorsProps {
  members: RoomMember[];
  /** Hidden on touch devices where users have no pointer. */
  hidden?: boolean;
}

/**
 * Subscribes to `cursors` at this leaf so cursor packets (~15 Hz per peer)
 * only re-render the cursor layer, not the entire room view. Moving the
 * subscription up to the screen-level component caused every jar, pulled
 * note, and form to reconcile on every packet — this keeps that work
 * contained.
 */
export const RemoteCursors = memo(function RemoteCursors({ members, hidden }: RemoteCursorsProps) {
  const cursors = useRoomStore((s) => s.cursors);
  // member lookup keyed by socket id (what cursor packets carry).
  const memberById = useMemo(() => {
    const map = new Map<string, RoomMember>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  if (hidden) return null;

  const entries: ReactElement[] = [];
  for (const [userId, cursor] of cursors) {
    const member = memberById.get(userId);
    if (!member) continue;
    entries.push(
      <Cursor
        key={userId}
        x={cursor.x}
        y={cursor.y}
        displayName={member.displayName}
        color={member.color}
      />,
    );
  }
  return <>{entries}</>;
});
