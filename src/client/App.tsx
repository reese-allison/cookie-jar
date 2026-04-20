import { useCallback, useMemo } from "react";
import { AuthHeader } from "./components/AuthHeader";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { InstallPrompt } from "./components/InstallPrompt";
import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { useJarActions } from "./hooks/useJarActions";
import { useJarName } from "./hooks/useJarName";
import { useSocket } from "./hooks/useSocket";
import { useSession } from "./lib/auth-client";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

type SessionUser = { displayName: string; image?: string } | null;

function App() {
  const { data: session } = useSession();
  // Narrow selectors everywhere — whole-store destructure would re-render on
  // every cursor packet (15 Hz per peer). Verified in
  // tests/client/stores/narrowSelectors.test.tsx.
  const room = useRoomStore((s) => s.room);

  const user: SessionUser = session?.user
    ? { displayName: session.user.name, image: session.user.image ?? undefined }
    : null;

  if (!room) return <LandingScreen user={user} />;
  return <InRoomScreen user={user} session={session} />;
}

function LandingScreen({ user }: { user: SessionUser }) {
  const isJoining = useRoomStore((s) => s.isJoining);
  const error = useRoomStore((s) => s.error);
  const setError = useRoomStore((s) => s.setError);
  const { joinRoom } = useSocket();
  const displayName = user?.displayName ?? "Host";

  const { isCreating, openRoomForJar, createJarAndJoin, cloneTemplateAndJoin } = useJarActions({
    displayName,
    joinRoom,
    setError,
  });

  const joinExistingRoom = useCallback(
    (code: string) => joinRoom(code, displayName),
    [joinRoom, displayName],
  );

  return (
    <main>
      {user && (
        <AuthHeader user={user} onJoinRoom={joinExistingRoom} onCreateRoom={openRoomForJar} />
      )}
      <RoomCodeEntry
        onJoin={joinRoom}
        onCreateJar={user ? createJarAndJoin : undefined}
        onCloneTemplate={user ? cloneTemplateAndJoin : undefined}
        isJoining={isJoining}
        isCreating={isCreating}
        error={error}
        user={user}
      />
      <InstallPrompt />
    </main>
  );
}

function InRoomScreen({
  user,
  session,
}: {
  user: SessionUser;
  session: ReturnType<typeof useSession>["data"];
}) {
  const room = useRoomStore((s) => s.room);
  const isConnected = useRoomStore((s) => s.isConnected);
  const cursors = useRoomStore((s) => s.cursors);
  const myId = useRoomStore((s) => s.myId);
  const setError = useRoomStore((s) => s.setError);
  const inJarCount = useNoteStore((s) => s.inJarCount);
  const pulledNotes = useNoteStore((s) => s.pulledNotes);
  const isAdding = useNoteStore((s) => s.isAdding);
  const jarConfig = useNoteStore((s) => s.jarConfig);
  const jarAppearance = useNoteStore((s) => s.jarAppearance);
  const history = useNoteStore((s) => s.history);
  const peerDrags = useNoteStore((s) => s.peerDrags);
  const sealedCount = useNoteStore((s) => s.sealedCount);
  const sealedRevealAt = useNoteStore((s) => s.sealedRevealAt);
  const {
    joinRoom,
    leaveRoom,
    moveCursor,
    lockRoom,
    unlockRoom,
    addNote,
    pullNote,
    discardNote,
    returnNote,
    getHistory,
    clearHistory,
    dragNote,
    dragNoteEnd,
    refreshJar,
  } = useSocket();
  const jarName = useJarName(room?.jarId);
  const displayName = user?.displayName ?? "Host";

  const { openRoomForJar } = useJarActions({ displayName, joinRoom, setError });

  const joinExistingRoom = useCallback(
    (code: string) => joinRoom(code, displayName),
    [joinRoom, displayName],
  );

  // Memoized: recomputes only when identity-relevant inputs change, not on
  // every cursor packet. `room?.members.find` is O(n) so worth caching.
  const { isViewer, isOwner } = useMemo(() => {
    const me = myId ? room?.members.find((m) => m.id === myId) : undefined;
    return {
      isViewer: me?.role === "viewer" || !session?.user,
      isOwner: me?.role === "owner",
    };
  }, [myId, room?.members, session?.user]);

  if (!room) return null;

  return (
    <main>
      <ConnectionStatus isConnected={isConnected} hasRoom={true} />
      {user && (
        <AuthHeader user={user} onJoinRoom={joinExistingRoom} onCreateRoom={openRoomForJar} />
      )}
      <RoomView
        room={room}
        cursors={cursors}
        inJarCount={inJarCount}
        pulledNotes={pulledNotes}
        isAdding={isAdding}
        isViewer={isViewer}
        isOwner={isOwner ?? false}
        showPulledBy={jarConfig?.showPulledBy ?? false}
        jarAppearance={jarAppearance ?? undefined}
        jarConfig={jarConfig ?? undefined}
        jarName={jarName}
        sealedCount={sealedCount}
        sealedRevealAt={sealedRevealAt}
        onMouseMove={moveCursor}
        onLock={lockRoom}
        onUnlock={unlockRoom}
        onLeave={leaveRoom}
        onJarRefresh={refreshJar}
        onAddNote={addNote}
        onPull={pullNote}
        onDiscard={discardNote}
        onReturn={returnNote}
        onDragNote={dragNote}
        onDragNoteEnd={dragNoteEnd}
        peerDrags={peerDrags}
        history={history}
        onGetHistory={getHistory}
        onClearHistory={isOwner ? clearHistory : undefined}
      />
    </main>
  );
}

export default App;
