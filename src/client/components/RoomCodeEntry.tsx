import { useState } from "react";

interface RoomCodeEntryProps {
  onJoin: (code: string, displayName: string) => void;
  isJoining: boolean;
  error: string | null;
}

export function RoomCodeEntry({ onJoin, isJoining, error }: RoomCodeEntryProps) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (code.trim() && displayName.trim()) {
      onJoin(code.trim().toUpperCase(), displayName.trim());
    }
  };

  return (
    <div className="room-code-entry">
      <h1>Cookie Jar</h1>
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
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your Name"
          maxLength={30}
          disabled={isJoining}
        />
        <button type="submit" disabled={isJoining || !code.trim() || !displayName.trim()}>
          {isJoining ? "Joining..." : "Join Room"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
