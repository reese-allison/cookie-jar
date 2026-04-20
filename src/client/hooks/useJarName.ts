import { useEffect, useState } from "react";

// Room state only carries the jar id, so fetch the jar name once per room
// (used by the room header and the owner settings drawer).
export function useJarName(jarId: string | undefined): string {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!jarId) {
      setName("");
      return;
    }
    let cancelled = false;
    fetch(`/api/jars/${jarId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((jar) => {
        if (!cancelled && jar?.name) setName(jar.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jarId]);

  return name;
}
