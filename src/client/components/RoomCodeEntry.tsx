import { useState } from "react";
import { CreateJar } from "./CreateJar";
import { SegmentedControl } from "./SegmentedControl";
import { TemplateBrowser } from "./TemplateBrowser";

type Tab = "join" | "host";

interface RoomCodeEntryProps {
  onJoin: (code: string, displayName: string) => void;
  onCreateJar?: (name: string) => void;
  isJoining: boolean;
  isCreating: boolean;
  error: string | null;
  user: { displayName: string; image?: string } | null;
  onCloneTemplate?: (jarId: string) => void;
  /** Prefilled when the user lands on /CODE but can't auto-join (anon). */
  initialCode?: string;
}

export function RoomCodeEntry({
  onJoin,
  onCreateJar,
  isJoining,
  isCreating,
  error,
  user,
  onCloneTemplate,
  initialCode,
}: RoomCodeEntryProps) {
  const [tab, setTab] = useState<Tab>("join");
  const [code, setCode] = useState(initialCode ?? "");
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

      <div className="room-code-entry__tabs">
        <SegmentedControl<Tab>
          label="What would you like to do?"
          value={tab}
          onChange={setTab}
          options={[
            { value: "join", label: "Join" },
            { value: "host", label: "Host" },
          ]}
        />
      </div>

      {tab === "join" ? (
        <>
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Room Code"
              aria-label="Room code"
              maxLength={6}
              className="room-code-input"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              disabled={isJoining}
            />
            {user ? (
              <input
                type="text"
                value={user.displayName}
                placeholder="Your Name"
                aria-label="Display name"
                maxLength={30}
                disabled
                readOnly
              />
            ) : (
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                aria-label="Guest name"
                placeholder="Guest Name"
                maxLength={30}
                disabled={isJoining}
              />
            )}
            <button
              type="submit"
              className="btn btn--hero"
              disabled={isJoining || !code.trim() || !displayName.trim()}
            >
              {isJoining ? "Joining..." : "Join Room"}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="room-code-entry__host">
          {!user && (
            <p className="room-code-entry__auth-note">
              Sign in from the top bar to host your own jar.
            </p>
          )}
          {onCreateJar && <CreateJar onCreate={onCreateJar} isCreating={isCreating} />}
          {onCloneTemplate && <TemplateBrowser onClone={onCloneTemplate} isCloning={isCreating} />}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
