import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Wraps a socket event handler to catch both sync and async errors.
 * Based on Socket.IO's recommended pattern:
 * https://socket.io/docs/v4/listening-to-events/#error-handling
 */
// biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
export function withErrorHandler(socket: TypedSocket, handler: (...args: any[]) => unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  return (...args: any[]) => {
    try {
      const result = handler(...args);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => {
          socket.emit("room:error", "Something went wrong");
        });
      }
    } catch {
      socket.emit("room:error", "Something went wrong");
    }
  };
}
