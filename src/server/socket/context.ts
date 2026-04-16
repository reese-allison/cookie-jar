import type { JarConfig } from "@shared/types";

export interface SocketContext {
  roomId: string | null;
  jarId: string | null;
  jarConfig: JarConfig | null;
  memberId: string | null;
  displayName: string | null;
}

export function createSocketContext(): SocketContext {
  return {
    roomId: null,
    jarId: null,
    jarConfig: null,
    memberId: null,
    displayName: null,
  };
}
