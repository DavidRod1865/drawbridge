import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a component failure shows an explanation instead of
 * a blank page. React unmounts the whole tree on an uncaught render error, so without
 * this the user sees white and has to open devtools to learn anything at all.
 *
 * Error boundaries must be class components — there is no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Drawbridge crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="centered">
        <div className="card">
          <h1>Something broke</h1>
          <p className="subtitle">
            Drawbridge hit an unexpected error. Nothing was uploaded to Procore.
          </p>
          <pre className="crash">{error.message}</pre>
          <button className="button primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <p className="fine-print">
            Parsing happens locally and nothing is stored, so reloading is safe — you
            will need to re-select your project and files.
          </p>
        </div>
      </main>
    );
  }
}
