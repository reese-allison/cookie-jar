/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../../src/client/components/ErrorBoundary";

afterEach(cleanup);

function Bomb({ throwError }: { throwError: boolean }) {
  if (throwError) throw new Error("kaboom");
  return <div data-testid="ok">alive</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Bomb throwError={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeDefined();
  });

  it("renders the fallback when a child throws", () => {
    // React logs caught errors to console.error — silence the noise for this test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb throwError={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/something went wrong/i);
    expect(screen.getByRole("button", { name: /reload/i })).toBeDefined();
    spy.mockRestore();
  });

  it("invokes onReset when the user clicks the reload button", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReset = vi.fn();
    render(
      <ErrorBoundary onReset={onReset}>
        <Bomb throwError={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("uses a custom fallback when supplied", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<p>custom</p>}>
        <Bomb throwError={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom")).toBeDefined();
    spy.mockRestore();
  });
});
