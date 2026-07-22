import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
      <main className="blueprint-grid grid min-h-screen place-items-center p-6">
        <Card className="w-full max-w-md overflow-hidden p-0">
          <div className="h-1 bg-destructive" />
          <div className="p-8">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Something broke</h1>
            <p className="mt-2 text-muted-foreground">
              Drawbridge hit an unexpected error. Nothing was uploaded to Procore.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
              {error.message}
            </pre>
            <Button className="mt-5" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
              Parsing happens locally and nothing is stored, so reloading is safe — you will
              need to re-select your project and files.
            </p>
          </div>
        </Card>
      </main>
    );
  }
}
