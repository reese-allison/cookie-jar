import type { Jar, RoomState } from "@shared/types";

export interface ActiveRoomSummary {
  code: string;
  state: RoomState;
  createdAt: string;
}

export interface OwnedJarWithRooms extends Jar {
  activeRooms: ActiveRoomSummary[];
}

export async function fetchMyJars(): Promise<OwnedJarWithRooms[]> {
  const res = await fetch("/api/jars/mine", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch jars");
  return res.json();
}
