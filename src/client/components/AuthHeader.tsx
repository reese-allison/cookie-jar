import { useCallback, useState } from "react";
import { signOut } from "../lib/auth-client";
import { MyJarsDrawer } from "./MyJarsDrawer";
import { TopBar } from "./TopBar";

interface AuthHeaderProps {
  user: { displayName: string; image?: string };
  onJoinRoom: (code: string) => void;
  onCreateRoom: (jarId: string) => void;
}

export function AuthHeader({ user, onJoinRoom, onCreateRoom }: AuthHeaderProps) {
  const [open, setOpen] = useState(false);

  const handleJoin = useCallback(
    (code: string) => {
      setOpen(false);
      onJoinRoom(code);
    },
    [onJoinRoom],
  );

  const handleCreate = useCallback(
    (jarId: string) => {
      setOpen(false);
      onCreateRoom(jarId);
    },
    [onCreateRoom],
  );

  return (
    <>
      <TopBar user={user} onOpenMyJars={() => setOpen(true)} onSignOut={() => signOut()} />
      <MyJarsDrawer
        open={open}
        onClose={() => setOpen(false)}
        onJoinRoom={handleJoin}
        onCreateRoom={handleCreate}
      />
    </>
  );
}
