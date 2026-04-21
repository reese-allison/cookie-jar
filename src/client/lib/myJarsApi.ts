import type { Jar, RoomState } from "@shared/types";

export interface ActiveRoomSummary {
  code: string;
  state: RoomState;
  createdAt: string;
}

export interface OwnedJarWithRooms extends Jar {
  activeRooms: ActiveRoomSummary[];
}

export interface StarredJarWithAccess extends Jar {
  activeRooms: ActiveRoomSummary[];
  /** False when the owner has removed the user from the allowlist since they starred. */
  hasAccess: boolean;
}

export interface MyJarsPayload {
  ownedJars: OwnedJarWithRooms[];
  starredJars: StarredJarWithAccess[];
}

export async function fetchMyJars(): Promise<MyJarsPayload> {
  const res = await fetch("/api/jars/mine", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch jars");
  return res.json();
}

export async function deleteJar(jarId: string): Promise<void> {
  const res = await fetch(`/api/jars/${encodeURIComponent(jarId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const msg = await res.json().catch(() => ({ error: "Failed to delete jar" }));
    throw new Error(msg.error ?? "Failed to delete jar");
  }
}

export async function starJar(jarId: string): Promise<void> {
  const res = await fetch(`/api/jars/${encodeURIComponent(jarId)}/star`, {
    method: "PUT",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const msg = await res.json().catch(() => ({ error: "Failed to star jar" }));
    throw new Error(msg.error ?? "Failed to star jar");
  }
}

export async function unstarJar(jarId: string): Promise<void> {
  const res = await fetch(`/api/jars/${encodeURIComponent(jarId)}/star`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const msg = await res.json().catch(() => ({ error: "Failed to unstar jar" }));
    throw new Error(msg.error ?? "Failed to unstar jar");
  }
}
