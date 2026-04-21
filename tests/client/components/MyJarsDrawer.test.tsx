/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyJarsDrawer } from "../../../src/client/components/MyJarsDrawer";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

const BASE_JAR = {
  appearance: {},
  config: {
    noteVisibility: "open",
    pullVisibility: "shared",
    sealedRevealCount: 1,
    showAuthors: false,
    showPulledBy: false,
    onLeaveBehavior: "return",
  },
  isTemplate: false,
  isPublic: false,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  ownerId: "u1",
};

function mineResponse(
  ownedJars: Array<Record<string, unknown>> = [],
  starredJars: Array<Record<string, unknown>> = [],
) {
  return okJson({ ownedJars, starredJars });
}

describe("MyJarsDrawer component", () => {
  it("does not fetch when closed", () => {
    render(
      <MyJarsDrawer open={false} onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an empty state when the user has no jars or stars", async () => {
    fetchMock.mockResolvedValueOnce(mineResponse());
    render(<MyJarsDrawer open onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/haven't made or starred any jars/i)).toBeDefined();
    });
  });

  it("lists owned jars by name with active room codes", async () => {
    fetchMock.mockResolvedValueOnce(
      mineResponse([
        {
          ...BASE_JAR,
          id: "j1",
          name: "Standup Prompts",
          activeRooms: [{ code: "ABCDEF", state: "open", createdAt: BASE_JAR.createdAt }],
        },
        {
          ...BASE_JAR,
          id: "j2",
          name: "Movie Night",
          activeRooms: [],
        },
      ]),
    );
    render(<MyJarsDrawer open onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Standup Prompts")).toBeDefined();
      expect(screen.getByText("Movie Night")).toBeDefined();
      expect(screen.getByText("ABCDEF")).toBeDefined();
    });
  });

  it("calls onJoinRoom with the code when Join is clicked", async () => {
    fetchMock.mockResolvedValueOnce(
      mineResponse([
        {
          ...BASE_JAR,
          id: "j1",
          name: "Standup",
          activeRooms: [{ code: "ZYXWVU", state: "open", createdAt: BASE_JAR.createdAt }],
        },
      ]),
    );
    const onJoinRoom = vi.fn();
    render(<MyJarsDrawer open onClose={vi.fn()} onJoinRoom={onJoinRoom} onCreateRoom={vi.fn()} />);
    const joinBtn = await screen.findByRole("button", { name: /join/i });
    fireEvent.click(joinBtn);
    expect(onJoinRoom).toHaveBeenCalledWith("ZYXWVU");
  });

  it("calls onCreateRoom with the jar id for jars without rooms", async () => {
    fetchMock.mockResolvedValueOnce(
      mineResponse([
        {
          ...BASE_JAR,
          id: "j-empty",
          name: "Fresh Jar",
          activeRooms: [],
        },
      ]),
    );
    const onCreateRoom = vi.fn();
    render(
      <MyJarsDrawer open onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={onCreateRoom} />,
    );
    const newRoomBtn = await screen.findByRole("button", { name: /new room/i });
    fireEvent.click(newRoomBtn);
    expect(onCreateRoom).toHaveBeenCalledWith("j-empty");
  });

  it("renders starred jars under their own section", async () => {
    fetchMock.mockResolvedValueOnce(
      mineResponse(
        [],
        [
          {
            ...BASE_JAR,
            id: "s1",
            name: "Friend's Jar",
            activeRooms: [{ code: "JOINME", state: "open", createdAt: BASE_JAR.createdAt }],
            hasAccess: true,
          },
        ],
      ),
    );
    render(<MyJarsDrawer open onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/starred/i)).toBeDefined();
      expect(screen.getByText("Friend's Jar")).toBeDefined();
      expect(screen.getByText("JOINME")).toBeDefined();
    });
  });

  it("renders a no-access notice for starred jars the user lost access to", async () => {
    fetchMock.mockResolvedValueOnce(
      mineResponse(
        [],
        [
          {
            ...BASE_JAR,
            id: "s2",
            name: "Locked-Out Jar",
            activeRooms: [],
            hasAccess: false,
          },
        ],
      ),
    );
    render(<MyJarsDrawer open onClose={vi.fn()} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no longer shown|removed your access/i)).toBeDefined();
      // No Join / New Room affordance when access is gone.
      expect(screen.queryByRole("button", { name: /new room/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^join$/i })).toBeNull();
    });
  });

  it("calls onClose when the close button is clicked", async () => {
    fetchMock.mockResolvedValueOnce(mineResponse());
    const onClose = vi.fn();
    render(<MyJarsDrawer open onClose={onClose} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/haven't made or starred any jars/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape so keyboard users can dismiss the drawer", async () => {
    fetchMock.mockResolvedValueOnce(mineResponse());
    const onClose = vi.fn();
    render(<MyJarsDrawer open onClose={onClose} onJoinRoom={vi.fn()} onCreateRoom={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/haven't made or starred any jars/i)).toBeDefined();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
