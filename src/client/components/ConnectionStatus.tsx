interface ConnectionStatusProps {
  isConnected: boolean;
  hasRoom: boolean;
}

export function ConnectionStatus({ isConnected, hasRoom }: ConnectionStatusProps) {
  // Only show when we had a room but lost connection
  if (isConnected || !hasRoom) return null;

  return (
    <div className="connection-status" role="alert">
      <p>Connection lost. Reconnecting...</p>
    </div>
  );
}
