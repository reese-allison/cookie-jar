import { useCallback, useState } from "react";

interface UseJarActionsOptions {
  displayName: string;
  joinRoom: (code: string, displayName: string) => void;
  setError: (error: string | null) => void;
}

export function useJarActions({ displayName, joinRoom, setError }: UseJarActionsOptions) {
  const [isCreating, setIsCreating] = useState(false);

  const openRoomForJar = useCallback(
    async (jarId: string): Promise<void> => {
      try {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ jarId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to create room" }));
          setError(data.error ?? "Failed to create room");
          return;
        }
        const newRoom = await res.json();
        joinRoom(newRoom.code, displayName);
      } catch {
        // Network-level failure (offline, DNS, CORS). Surface a friendly error
        // instead of letting the promise reject unhandled.
        setError("Couldn't reach the server — check your connection.");
      }
    },
    [displayName, joinRoom, setError],
  );

  const createJarAndJoin = useCallback(
    async (name: string) => {
      setIsCreating(true);
      try {
        const jarRes = await fetch("/api/jars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        if (!jarRes.ok) {
          const data = await jarRes.json();
          setError(data.error ?? "Failed to create jar");
          return;
        }
        const jar = await jarRes.json();
        await openRoomForJar(jar.id);
      } catch {
        setError("Something went wrong");
      } finally {
        setIsCreating(false);
      }
    },
    [openRoomForJar, setError],
  );

  const cloneTemplateAndJoin = useCallback(
    async (jarId: string) => {
      setIsCreating(true);
      try {
        const cloneRes = await fetch(`/api/jars/${jarId}/clone`, {
          method: "POST",
          credentials: "include",
        });
        if (!cloneRes.ok) {
          const data = await cloneRes.json();
          setError(data.error ?? "Failed to clone template");
          return;
        }
        const cloned = await cloneRes.json();
        await openRoomForJar(cloned.id);
      } catch {
        setError("Something went wrong");
      } finally {
        setIsCreating(false);
      }
    },
    [openRoomForJar, setError],
  );

  return { isCreating, openRoomForJar, createJarAndJoin, cloneTemplateAndJoin };
}
