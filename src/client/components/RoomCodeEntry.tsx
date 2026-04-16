import { useState } from "react";
import { AuthButtons } from "./AuthButtons";
import { CreateJar } from "./CreateJar";
import { TemplateBrowser } from "./TemplateBrowser";
import { UserMenu } from "./UserMenu";

interface RoomCodeEntryProps {
  onJoin: (code: string, displayName: string) => void;
  onCreateJar?: (name: string) => void;
  isJoining: boolean;
  isCreating: boolean;
  error: string | null;
  user: { displayName: string; image?: string } | null;
  onCloneTemplate?: (jarId: string) => void;
}

export function RoomCodeEntry({
  onJoin,
  onCreateJar,
  isJoining,
  isCreating,
  error,
  user,
  onCloneTemplate,
}: RoomCodeEntryProps) {
  const [code, setCode] = useState("");
  const [guestName, setGuestName] = useState("");

  const displayName = user?.displayName ?? guestName;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (code.trim() && displayName.trim()) {
      onJoin(code.trim().toUpperCase(), displayName.trim());
    }
  };

  return (
    <div className="room-code-entry">
      <h1>Cookie Jar</h1>

      {user ? (
        <UserMenu displayName={user.displayName} image={user.image} />
      ) : (
        <div className="room-code-entry__auth">
          <AuthButtons />
          <p className="room-code-entry__guest-note">Or join as a guest (view only)</p>
        </div>
      )}

      {onCreateJar && <CreateJar onCreate={onCreateJar} isCreating={isCreating} />}

      {onCloneTemplate && <TemplateBrowser onClone={onCloneTemplate} isCloning={isCreating} />}

      <div className="room-code-entry__divider">
        <span>or join an existing room</span>
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Room Code"
          maxLength={6}
          className="room-code-input"
          autoComplete="off"
          disabled={isJoining}
        />
        {user ? (
          <input
            type="text"
            value={user.displayName}
            placeholder="Your Name"
            maxLength={30}
            disabled
            readOnly
          />
        ) : (
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Guest Name"
            maxLength={30}
            disabled={isJoining}
          />
        )}
        <button type="submit" disabled={isJoining || !code.trim() || !displayName.trim()}>
          {isJoining ? "Joining..." : "Join Room"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
