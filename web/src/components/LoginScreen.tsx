const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    'Login session expired or was tampered with. Please try again.',
  exchange_failed:
    'Procore rejected the authorization code. Check that the redirect URI registered on your Procore app exactly matches PROCORE_REDIRECT_URI.',
  access_denied: 'Authorization was declined in Procore.',
};

export function LoginScreen({ error }: { error?: string }) {
  return (
    <main className="centered">
      <div className="card">
        <h1>Drawbridge</h1>
        <p className="subtitle">
          Validate and upload drawing packages to Procore, without the cleanup.
        </p>

        {error && (
          <p className="error" role="alert">
            {AUTH_ERROR_MESSAGES[error] ?? `Login failed: ${error}`}
          </p>
        )}

        {/* A plain link, not fetch(): OAuth requires a top-level browser navigation
            so Procore can set its own cookies and show its consent screen. */}
        <a className="button primary" href="/api/auth/login">
          Connect to Procore
        </a>

        <p className="fine-print">
          Drawbridge stores nothing. Files upload directly from your browser to
          Procore, and drawings are left unpublished for you to review.
        </p>
      </div>
    </main>
  );
}
