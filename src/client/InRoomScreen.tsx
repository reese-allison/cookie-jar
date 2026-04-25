// Code-split target. Lazy-loaded by App so the landing visitor doesn't pay
// for RoomView's drag/animation code, ConnectionStatus, jar-action helpers,
// etc. — they only ship when a user is actually entering a room.
import { useCallback, useMemo } from "react";
import { AuthHeader } from "./components/AuthHeader";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { RoomView } from "./components/RoomView";
import { useJarActions } from "./hooks/useJarActions";
import type { useSocket } from "./hooks/useSocket";
import type { useSession } from "./lib/auth-client";
import { starJar, unstarJar } from "./lib/myJarsApi";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

type SessionUser = { displayName: string; image?: string } | null;
type SocketApi = ReturnType<typeof useSocket>;

interface InRoomScreenProps {
  user: SessionUser;
  session: ReturnType<typeof useSession>["data"];
  socketApi: SocketApi;
  onRequestSignIn: () => void;
}

function InRoomScreen({ user, session, socketApi, onRequestSignIn }: InRoomScreenProps) {
  const room = useRoomStore((s) => s.room);
  const isConnected = useRoomStore((s) => s.isConnected);
  // NB: `cursors` intentionally NOT subscribed here — RemoteCursors reads
  // it directly at the leaf so peer packets don't re-render this whole tree.
  const myId = useRoomStore((s) => s.myId);
  const setError = useRoomStore((s) => s.setError);
  const inJarCount = useNoteStore((s) => s.inJarCount);
  const pulledNotes = useNoteStore((s) => s.pulledNotes);
  const isAdding = useNoteStore((s) => s.isAdding);
  const jarConfig = useNoteStore((s) => s.jarConfig);
  const jarAppearance = useNoteStore((s) => s.jarAppearance);
  const jarName = useNoteStore((s) => s.jarName);
  const history = useNoteStore((s) => s.history);
  const sealedCount = useNoteStore((s) => s.sealedCount);
  const sealedRevealAt = useNoteStore((s) => s.sealedRevealAt);
  const isStarred = useNoteStore((s) => s.isStarred);
  const setStarred = useNoteStore((s) => s.setStarred);
  const {
    joinRoom,
    leaveRoom,
    moveCursor,
    addNote,
    pullNote,
    discardNote,
    returnNote,
    returnAllNotes,
    discardAllNotes,
    getHistory,
    clearHistory,
    dragNote,
    dragNoteEnd,
    refreshJar,
  } = socketApi;
  const displayName = user?.displayName ?? "Host";

  const { openRoomForJar } = useJarActions({ displayName, joinRoom, setError });

  const joinExistingRoom = useCallback(
    (code: string) => joinRoom(code, displayName),
    [joinRoom, displayName],
  );

  const handleToggleStar = useCallback(async () => {
    const jarId = room?.jarId;
    if (!jarId) return;
    // Optimistic flip so the star fills immediately. On failure, revert.
    const nextStarred = !isStarred;
    setStarred(nextStarred);
    try {
      if (nextStarred) await starJar(jarId);
      else await unstarJar(jarId);
    } catch {
      setStarred(!nextStarred);
    }
  }, [room?.jarId, isStarred, setStarred]);

  // Memoized: recomputes only when identity-relevant inputs change, not on
  // every cursor packet. `room?.members.find` is O(n) so worth caching.
  // `roleKnown` gates owner-only UI so a jar owner doesn't briefly see
  // contributor affordances (like the star button) before the members array
  // catches up to myId.
  const { isViewer, isOwner, roleKnown } = useMemo(() => {
    const me = myId ? room?.members.find((m) => m.id === myId) : undefined;
    return {
      isViewer: me?.role === "viewer" || !session?.user,
      isOwner: me?.role === "owner",
      roleKnown: me !== undefined,
    };
  }, [myId, room?.members, session?.user]);

  if (!room) return null;

  return (
    <main>
      <ConnectionStatus isConnected={isConnected} hasRoom={true} />
      <AuthHeader
        user={user}
        onJoinRoom={joinExistingRoom}
        onCreateRoom={openRoomForJar}
        onRequestSignIn={onRequestSignIn}
        onLeaveRoom={leaveRoom}
      />
      <RoomView
        room={room}
        inJarCount={inJarCount}
        pulledNotes={pulledNotes}
        isAdding={isAdding}
        isViewer={isViewer}
        isOwner={isOwner ?? false}
        showPulledBy={jarConfig?.showPulledBy ?? false}
        showAuthors={jarConfig?.showAuthors ?? false}
        jarAppearance={jarAppearance ?? undefined}
        jarConfig={jarConfig ?? undefined}
        jarName={jarName ?? undefined}
        sealedCount={sealedCount}
        sealedRevealAt={sealedRevealAt}
        onMouseMove={moveCursor}
        onLeave={leaveRoom}
        onJarRefresh={refreshJar}
        onAddNote={addNote}
        onPull={pullNote}
        onDiscard={discardNote}
        onReturn={returnNote}
        onReturnAll={isOwner ? returnAllNotes : undefined}
        onDiscardAll={isOwner ? discardAllNotes : undefined}
        onDragNote={dragNote}
        onDragNoteEnd={dragNoteEnd}
        history={history}
        onGetHistory={getHistory}
        onClearHistory={isOwner ? clearHistory : undefined}
        onSignIn={onRequestSignIn}
        isStarred={isStarred}
        onToggleStar={!roleKnown || isOwner ? undefined : handleToggleStar}
      />
    </main>
  );
}

export default InRoomScreen;
