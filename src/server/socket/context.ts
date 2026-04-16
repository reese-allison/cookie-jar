export interface SocketContext {
  roomId: string | null;
  jarId: string | null;
  memberId: string | null;
}

export function createSocketContext(): SocketContext {
  return {
    roomId: null,
    jarId: null,
    memberId: null,
  };
}
