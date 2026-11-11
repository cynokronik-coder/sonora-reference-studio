export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  user: AuthUser;
}

interface AuthPayload {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  user?: AuthUser;
  error?: string;
  error_description?: string;
  msg?: string;
}

const STORAGE_KEY = 'sonora.supabase.session.v1';
const listeners = new Set<(session: AuthSession | null) => void>();
let currentSession: AuthSession | null | undefined;
let refreshPromise: Promise<AuthSession | null> | null = null;

export function getSupabaseConfig() {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '');
  return { configured: Boolean(url && anonKey), url, anonKey };
}

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession | null) {
  currentSession = session;
  if (typeof window !== 'undefined') {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener(session));
}

function sessionFromPayload(payload: AuthPayload): AuthSession {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    throw new Error(payload.error_description || payload.msg || 'The authentication provider returned an incomplete session.');
  }
  const expiresAt = payload.expires_at ?? Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600);
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type || 'bearer',
    expires_at: expiresAt,
    user: payload.user,
  };
}

async function authRequest(path: string, body?: Record<string, unknown>, accessToken?: string, method: 'POST' | 'PUT' = 'POST'): Promise<AuthPayload> {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error('Supabase Auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: body ? method : 'GET',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as AuthPayload;
  if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.error || `Authentication failed (${response.status}).`);
  return payload;
}

export function subscribeToAuth(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  if (currentSession !== undefined) listener(currentSession);
  return () => listeners.delete(listener);
}

async function recoverSessionFromRedirect(): Promise<AuthSession | null> {
  if (typeof window === 'undefined') return null;
  const config = getSupabaseConfig();
  if (!config.configured) return null;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const user = await response.json().catch(() => null) as AuthUser | null;
    if (!response.ok || !user?.id) throw new Error('Email confirmation returned an invalid session.');
    const expiresIn = Number(params.get('expires_in') || 3600);
    const session: AuthSession = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get('token_type') || 'bearer',
      expires_at: Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + expiresIn,
      user,
    };
    persistSession(session);
    // Remove tokens from the URL and browser history after validation.
    const destination = params.get('type') === 'recovery' ? '#reset-password' : '#account';
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}${destination}`);
    return session;
  } catch {
    const destination = params.get('type') === 'recovery' ? '#reset-password' : '#account';
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}${destination}`);
    return null;
  }
}

export async function getAuthSession(): Promise<AuthSession | null> {
  if (currentSession === undefined) {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const isRecoveryCallback = hash.includes('type=recovery') || hash.includes('access_token=') && hash.includes('type=recovery');
    if (isRecoveryCallback) {
      await recoverSessionFromRedirect();
    } else {
      currentSession = readStoredSession();
      if (!currentSession) await recoverSessionFromRedirect();
    }
  }
  const session = currentSession;
  if (!session) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const payload = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      const refreshed = sessionFromPayload(payload);
      persistSession(refreshed);
      return refreshed;
    } catch {
      persistSession(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function getAuthAccessToken(): Promise<string | null> {
  return (await getAuthSession())?.access_token ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const payload = await authRequest('token?grant_type=password', { email: email.trim(), password });
  const session = sessionFromPayload(payload);
  persistSession(session);
  return session;
}

export async function signUpWithPassword(email: string, password: string): Promise<{ session: AuthSession | null; confirmationRequired: boolean }> {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error('Supabase Auth is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  const response = await fetch(`${config.url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin + '/#account' },
    }),
  });
  const payload = await response.json().catch(() => ({})) as AuthPayload;
  if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.error || `Sign-up failed (${response.status}).`);
  if (payload.access_token && payload.refresh_token && payload.user?.id) {
    const session = sessionFromPayload(payload);
    persistSession(session);
    return { session, confirmationRequired: false };
  }
  return { session: null, confirmationRequired: true };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error('Supabase Auth is not configured.');
  const redirectTo = `${window.location.origin}/#reset-password`;
  await authRequest(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email: email.trim() });
}

export async function updatePassword(password: string): Promise<void> {
  const session = await getAuthSession();
  if (!session) throw new Error('This password reset link is invalid or expired. Request a new one.');
  await authRequest('user', { password }, session.access_token, 'PUT');
}

export async function signOut(): Promise<void> {
  const session = await getAuthSession();
  if (session) {
    try {
      await authRequest('logout', {}, session.access_token);
    } finally {
      persistSession(null);
    }
  } else {
    persistSession(null);
  }
}

export function isSupabaseAuthConfigured() {
  return getSupabaseConfig().configured;
}
