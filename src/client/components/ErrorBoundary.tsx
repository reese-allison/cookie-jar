import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback markup. Defaults to a branded "Something went wrong" card. */
  fallback?: ReactNode;
  /**
   * Called when the user hits "Reload". The default handler reloads the page;
   * callers that want a softer reset (e.g. re-mount just the subtree) can
   * supply their own.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Class component because React only supports error boundaries via
 * `componentDidCatch` / `getDerivedStateFromError` — no hook equivalent.
 * Placed at the App root so any child throw (malformed socket payload, a
 * bad date format, a map key collision in a render) doesn't blank the
 * whole screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console is the right sink client-side — Sentry/LogRocket would hook in
    // here if we add them later. Keep the log surface minimal.
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
    else window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__message">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button type="button" className="btn" onClick={this.handleReset}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
