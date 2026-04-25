import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AuthHeader } from "./components/AuthHeader";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorToast } from "./components/ErrorToast";
import { InstallPrompt } from "./components/InstallPrompt";
import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { useJarActions } from "./hooks/useJarActions";
import { useRoomUrlSync } from "./hooks/useRoomUrlSync";
import { useSocket } from "./hooks/useSocket";
import { useSession } from "./lib/auth-client";
import { useRoomStore } from "./stores/roomStore";

// Code-split the in-room experience: RoomView pulls in drag/animation libs
// (~40 KiB of JS Lighthouse flagged as unused on the landing page). The
// landing visitor only downloads it if/when they actually enter a room.
const InRoomScreen = lazy(() => import("./InRoomScreen"));

// SignInModal is rendered only when the user clicks "Sign in". Lazy-loading
// it keeps the OAuth provider button code (~few KiB) out of first paint,
// and gating the import on `signInOpen` means the chunk isn't even fetched
// until the modal opens.
const SignInModal = lazy(() =>
  import("./components/SignInModal").then((m) => ({ default: m.SignInModal })),
);

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

  // URL ↔ room sync. Auto-join only for signed-in users — an anonymous
  // visitor who hits /ABCDEF should see the landing form with the code
  // prefilled so they can choose a guest name first.
  const displayName = user?.displayName ?? "Guest";
  const initialCode = useRoomUrlSync({
    joinRoom: socketApi.joinRoom,
    leaveRoom: socketApi.leaveRoom,
    displayName,
    canAutoJoin: Boolean(user),
  });

  // Deep-link CLS guard: when the URL has a code AND we're authed, the auto-
  // join is firing right now — painting LandingScreen for a few hundred ms
  // before swapping to InRoomScreen produced a measurable layout shift. Show a
  // viewport-sized neutral shell instead so layout is stable from first paint.
  // Once we've entered a room at least once, the auto-join phase is over —
  // gate on this so leaving the room doesn't drop us back onto a forever-
  // spinner just because `initialCode` is still truthy from mount.
  const [hasEnteredRoom, setHasEnteredRoom] = useState(false);
  useEffect(() => {
    if (room && !hasEnteredRoom) setHasEnteredRoom(true);
  }, [room, hasEnteredRoom]);
  const isAutoJoining = Boolean(initialCode) && Boolean(user) && !room && !hasEnteredRoom;

  return (
    <ErrorBoundary>
      <ErrorToast />
      {room ? (
        <Suspense fallback={<LoadingShell />}>
          <InRoomScreen
            user={user}
            session={session}
            socketApi={socketApi}
            onRequestSignIn={openSignIn}
          />
        </Suspense>
      ) : isAutoJoining ? (
        <LoadingShell />
      ) : (
        <LandingScreen
          user={user}
          socketApi={socketApi}
          onRequestSignIn={openSignIn}
          initialCode={initialCode}
        />
      )}
      {signInOpen && (
        <Suspense fallback={null}>
          <SignInModal open={signInOpen} onClose={closeSignIn} />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

function LoadingShell() {
  return (
    <main className="loading-shell" role="status" aria-busy="true" aria-live="polite">
      <span className="loading-shell__spinner" aria-hidden="true" />
      <span className="sr-only">Joining room…</span>
    </main>
  );
}

function LandingScreen({
  user,
  socketApi,
  onRequestSignIn,
  initialCode,
}: {
  user: SessionUser;
  socketApi: SocketApi;
  onRequestSignIn: () => void;
  initialCode: string | null;
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
        initialCode={initialCode ?? undefined}
      />
      <InstallPrompt />
    </main>
  );
}

export default App;
