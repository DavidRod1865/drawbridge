import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    'Login session expired or was tampered with. Please try again.',
  exchange_failed:
    'Procore rejected the authorization code. Check that the redirect URI registered on your Procore app exactly matches PROCORE_REDIRECT_URI.',
  access_denied: 'Authorization was declined in Procore.',
};

export function LoginScreen({ error }: { error?: string }) {
  return (
    <main className="blueprint-grid grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md overflow-hidden p-0">
        {/* Accent rule — the blueprint's title-block edge. */}
        <div className="h-1 bg-primary" />
        <div className="p-8">
          <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
            Procore · Drawings
          </p>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">Drawbridge</h1>
          <p className="mt-2 text-muted-foreground">
            Validate and upload drawing packages to Procore, without the cleanup.
          </p>

          {error && (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>
                {AUTH_ERROR_MESSAGES[error] ?? `Login failed: ${error}`}
              </AlertDescription>
            </Alert>
          )}

          {/* A plain link, not fetch(): OAuth requires a top-level browser navigation
              so Procore can set its own cookies and show its consent screen. */}
          <Button asChild size="lg" className="mt-6 w-full">
            <a href="/api/auth/login">Connect to Procore</a>
          </Button>

          <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
            Drawbridge stores nothing. Files upload directly from your browser to Procore,
            and drawings are left unpublished for you to review.
          </p>
        </div>
      </Card>
    </main>
  );
}
