import { useCallback, useMemo, useState } from "react";
import { AuthHeader } from "./components/AuthHeader";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorToast } from "./components/ErrorToast";
import { InstallPrompt } from "./components/InstallPrompt";
import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { SignInModal } from "./components/SignInModal";
import { useJarActions } from "./hooks/useJarActions";
import { useSocket } from "./hooks/useSocket";
import { useSession } from "./lib/auth-client";
import { starJar, unstarJar } from "./lib/myJarsApi";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

type SessionUser = { displayName: string; image?: string } | null;
type SocketApi = ReturnType<typeof useSocket>;

function App() {
  const { data: session } = useSession();
  // Narrow selectors everywhere — whole-store destructure would re-render on
  // every cursor packet (15 Hz per peer). Verified in
  // tests/client/stores/narrowSelectors.test.tsx.
  const room = useRoomStore((s) => s.room);

  const user: SessionUser = session?.user
    ? { displayName: session.user.name, image: session.user.image ?? undefined }
    : null;

  // Sign-in modal lives at the App root so it can be opened from any surface
  // (TopBar, viewer notice in a room, auth:expired handler) without context
  // gymnastics.
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = useCallback(() => setSignInOpen(true), []);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);

  // Socket must be owned by App — not by the screens — so it survives the
  // Landing → InRoom transition that happens when `room:state` arrives.
  // Regression guard: tests/client/App.socketLifetime.test.tsx. The
  // onAuthExpired hook opens the sign-in modal automatically — the error
  // toast alone auto-dismisses in 6 s and a busy user would miss it.
  const socketApi = useSocket({ onAuthExpired: openSignIn });

  return (
    <ErrorBoundary>
      <ErrorToast />
      {room ? (
        <InRoomScreen
          user={user}
          session={session}
          socketApi={socketApi}
          onRequestSignIn={openSignIn}
        />
      ) : (
        <LandingScreen user={user} socketApi={socketApi} onRequestSignIn={openSignIn} />
      )}
      <SignInModal open={signInOpen} onClose={closeSignIn} />
    </ErrorBoundary>
  );
}

function LandingScreen({
  user,
  socketApi,
  onRequestSignIn,
}: {
  user: SessionUser;
  socketApi: SocketApi;
  onRequestSignIn: () => void;
}) {
  const isJoining = useRoomStore((s) => s.isJoining);
  const error = useRoomStore((s) => s.error);
  const setError = useRoomStore((s) => s.setError);
  const { joinRoom } = socketApi;
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
      <AuthHeader
        user={user}
        onJoinRoom={joinExistingRoom}
        onCreateRoom={openRoomForJar}
        onRequestSignIn={onRequestSignIn}
      />
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
  socketApi,
  onRequestSignIn,
}: {
  user: SessionUser;
  session: ReturnType<typeof useSession>["data"];
  socketApi: SocketApi;
  onRequestSignIn: () => void;
}) {
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
        onToggleStar={isOwner ? undefined : handleToggleStar}
      />
    </main>
  );
}

export default App;
