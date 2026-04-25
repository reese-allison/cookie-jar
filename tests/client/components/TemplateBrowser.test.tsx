/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateBrowser } from "../../../src/client/components/TemplateBrowser";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TEMPLATE = {
  id: "t1",
  name: "Standup Prompts",
  ownerId: "system",
  isTemplate: true,
  isPublic: true,
  appearance: {},
  config: {},
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("TemplateBrowser", () => {
  it("does not fetch templates until the browser is opened", () => {
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches templates and renders them when opened", async () => {
    fetchMock.mockResolvedValueOnce(okJson([TEMPLATE]));
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    await waitFor(() => {
      expect(screen.getByText("Standup Prompts")).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/jars/templates/list");
  });

  it("invokes onClone with the template id when 'Use this' is clicked", async () => {
    fetchMock.mockResolvedValueOnce(okJson([TEMPLATE]));
    const onClone = vi.fn();
    render(<TemplateBrowser onClone={onClone} isCloning={false} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    const useBtn = await screen.findByRole("button", { name: /use this/i });
    fireEvent.click(useBtn);
    expect(onClone).toHaveBeenCalledWith("t1");
  });

  it("disables the clone button and shows 'Cloning...' while cloning is in flight", async () => {
    fetchMock.mockResolvedValueOnce(okJson([TEMPLATE]));
    render(<TemplateBrowser onClone={vi.fn()} isCloning={true} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    const cloneBtn = await screen.findByRole("button", { name: /cloning/i });
    expect((cloneBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the empty state when the API returns no templates", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    await waitFor(() => {
      expect(screen.getByText(/no templates available/i)).toBeDefined();
    });
  });

  it("shows the failure message on a non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to load templates/i)).toBeDefined();
    });
  });

  it("shows the failure message when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to load templates/i)).toBeDefined();
    });
  });

  it("retries the fetch when reopened after a failed first load", async () => {
    // Without retry-on-reopen, a transient network blip on first open would
    // strand the user on "Failed to load templates" forever.
    fetchMock.mockRejectedValueOnce(new Error("transient"));
    fetchMock.mockResolvedValueOnce(okJson([TEMPLATE]));
    render(<TemplateBrowser onClone={vi.fn()} isCloning={false} />);
    const toggle = screen.getByRole("button", { name: /browse templates/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText(/failed to load templates/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /hide templates/i }));
    fireEvent.click(screen.getByRole("button", { name: /browse templates/i }));
    await waitFor(() => {
      expect(screen.getByText("Standup Prompts")).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
