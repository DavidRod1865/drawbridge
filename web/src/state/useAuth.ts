import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

interface AuthStatus {
  authenticated: boolean;
  expired?: boolean;
  environment?: 'sandbox' | 'production';
}

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; error?: string }
  | { status: 'authenticated'; environment: 'sandbox' | 'production' };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    // Procore reports OAuth failures by redirecting back with a query param rather
    // than a body, so surface it before it is cleared from the URL.
    const authError = new URLSearchParams(window.location.search).get('auth_error');

    try {
      const status = await apiFetch<AuthStatus>('/api/auth/status');
      if (status.authenticated) {
        setState({ status: 'authenticated', environment: status.environment ?? 'sandbox' });
        if (authError) window.history.replaceState({}, '', window.location.pathname);
        return;
      }
    } catch {
      // Status is unauthenticated-by-default; a network failure is not fatal here.
    }

    setState(authError ? { status: 'anonymous', error: authError } : { status: 'anonymous' });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setState({ status: 'anonymous' });
  }, []);

  return { state, refresh, logout };
}
