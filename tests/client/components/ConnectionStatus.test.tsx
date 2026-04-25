/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionStatus } from "../../../src/client/components/ConnectionStatus";

afterEach(cleanup);

describe("ConnectionStatus", () => {
  it("renders nothing when connected", () => {
    const { container } = render(<ConnectionStatus isConnected={true} hasRoom={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no room, even if disconnected", () => {
    // Connection drops on the landing screen shouldn't pop a banner — there's
    // nothing to reconnect *to*.
    const { container } = render(<ConnectionStatus isConnected={false} hasRoom={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the reconnecting alert when in a room and disconnected", () => {
    render(<ConnectionStatus isConnected={false} hasRoom={true} />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });
});
