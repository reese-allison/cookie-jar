import { useCallback, useState } from "react";
import { signOut } from "../lib/auth-client";
import { useRoomStore } from "../stores/roomStore";
import { MyJarsDrawer } from "./MyJarsDrawer";
import { TopBar } from "./TopBar";

interface AuthHeaderProps {
  /** Null when the visitor is unauthenticated — TopBar still renders with a Sign in button. */
  user: { displayName: string; image?: string } | null;
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
  onRequestSignIn: () => void;
  /**
   * Optional: supplied when the user is currently in a room so sign-out can
   * leave cleanly. Without it, the server would disconnect the socket when
   * the session evaporates but the client would briefly show a broken room.
   */
  onLeaveRoom?: () => void;
}

export function AuthHeader({
  user,
  onJoinRoom,
  onCreateRoom,
  onRequestSignIn,
  onLeaveRoom,
}: AuthHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hasRoom = useRoomStore((s) => s.room !== null);

  const handleJoin = useCallback(
    (code: string) => {
      setDrawerOpen(false);
      onJoinRoom(code);
    },
    [onJoinRoom],
  );

  const handleCreate = useCallback(
    (jarId: string) => {
      setDrawerOpen(false);
      onCreateRoom(jarId);
    },
    [onCreateRoom],
  );

  const handleSignOut = useCallback(async () => {
    if (hasRoom && onLeaveRoom) onLeaveRoom();
    await signOut();
  }, [hasRoom, onLeaveRoom]);

  if (!user) {
    return <TopBar user={null} onSignIn={onRequestSignIn} />;
  }

  return (
    <>
      <TopBar user={user} onOpenMyJars={() => setDrawerOpen(true)} onSignOut={handleSignOut} />
      <MyJarsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onJoinRoom={handleJoin}
        onCreateRoom={handleCreate}
      />
    </>
  );
}
