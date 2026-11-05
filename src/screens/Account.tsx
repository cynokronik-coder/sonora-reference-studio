import { useEffect, useState, type FormEvent } from 'react';
import { getAuthSession, isSupabaseAuthConfigured, signInWithPassword, signOut, signUpWithPassword, subscribeToAuth, type AuthSession } from '../lib/auth';
import { getBillingStatus, getEntitlements, openBillingPortal, type BillingStatus, type Entitlements } from '../lib/billing';
import { Badge, Button, Panel } from '../ui/Primitives';

export default function Account() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (active: AuthSession | null) => {
    try {
      const config = await getBillingStatus();
      setStatus(config);
    } catch {
      setStatus(null);
    }
    if (active) {
      try { setEntitlements(await getEntitlements()); }
      catch { setEntitlements(null); }
    } else {
      setEntitlements(null);
    }
  };

  useEffect(() => {
    let alive = true;
    void getAuthSession().then((active) => {
      if (!alive) return;
      setSession(active);
      void refresh(active);
    });
    const unsubscribe = subscribeToAuth((active) => {
      if (!alive) return;
      setSession(active);
      void refresh(active);
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const active = await signInWithPassword(email, password);
        setSession(active);
        setMessage('You are signed in. Your account and billing status have been refreshed.');
        await refresh(active);
      } else {
        const result = await signUpWithPassword(email, password);
        if (result.session) {
          setSession(result.session);
          setMessage('Your Sonora account is ready.');
          await refresh(result.session);
        } else {
          setMessage('Check your inbox to confirm your email, then return here to sign in.');
        }
      }
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      setSession(null);
      setEntitlements(null);
      setMessage('You have been signed out.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign out failed.');
    } finally {
      setBusy(false);
    }
  };

  const manageBilling = async () => {
    setBusy(true);
    setError(null);
    try { await openBillingPortal(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open billing portal.'); setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header>
        <p className="section-label">Your Sonora identity</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-white sm:text-3xl">Account & membership</h1>
        <p className="mt-2 text-sm leading-6 text-ink-400">Sign in to manage your Sonora membership. Billing access is only enabled after the Supabase and Stripe environment is configured.</p>
      </header>

      {message && <div role="status" className="rounded-xl border border-accent/20 bg-accent/[.06] px-4 py-3 text-xs text-accent">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-signal-red/25 bg-signal-red/[.06] px-4 py-3 text-xs text-signal-red">{error}</div>}

      {!isSupabaseAuthConfigured() ? (
        <Panel title="Account configuration" right={<Badge tone="warn">Not configured</Badge>}>
          <p className="text-sm leading-6 text-ink-300">Supabase Auth is not connected to this deployment yet. Add <code className="text-accent">VITE_SUPABASE_URL</code> and <code className="text-accent">VITE_SUPABASE_ANON_KEY</code> to the frontend environment, and the matching server-side Supabase credentials to the API environment.</p>
          <p className="mt-3 text-xs leading-5 text-ink-500">Never place a Supabase service-role or secret key in a VITE_ variable, frontend source file, or browser request.</p>
        </Panel>
      ) : session ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <Panel title="Signed-in account" right={<Badge tone="accent">Authenticated</Badge>}>
            <div className="space-y-3">
              <div><p className="section-label">Email</p><p className="mt-1 text-sm text-white">{session.user.email || 'Email unavailable'}</p></div>
              <div><p className="section-label">User ID</p><p className="mt-1 break-all font-mono text-2xs text-ink-500">{session.user.id}</p></div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="ghost" onClick={() => void refresh(session)}>Refresh account</Button>
                <Button size="sm" variant="ghost" onClick={() => void handleSignOut()} disabled={busy}>Sign out</Button>
              </div>
            </div>
          </Panel>
          <Panel title="Membership" right={<Badge tone={entitlements?.plan && entitlements.plan !== 'free' ? 'accent' : 'neutral'}>{entitlements?.plan || 'Free'}</Badge>}>
            {entitlements ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-ink-500">Subscription status</span><span className="text-xs text-ink-200">{entitlements.subscriptionStatus || 'Free plan'}</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-ink-500">AI credits remaining</span><span className="font-mono text-sm text-white">{entitlements.aiCredits.remaining} / {entitlements.aiCredits.allowance}</span></div>
                {entitlements.aiCredits.purchased.total > 0 && <div className="flex items-center justify-between gap-3"><span className="text-xs text-ink-500">Purchased credits remaining</span><span className="font-mono text-sm text-white">{entitlements.aiCredits.purchased.remaining}</span></div>}
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]"><div className="h-full rounded-full bg-accent" style={{ width: `${entitlements.aiCredits.allowance ? Math.max(0, Math.min(100, entitlements.aiCredits.remaining / entitlements.aiCredits.allowance * 100)) : 0}%` }} /></div>
                {entitlements.currentPeriodEnd && <p className="text-2xs text-ink-500">Current period ends {new Date(entitlements.currentPeriodEnd).toLocaleDateString()}</p>}
                {entitlements.cancelAtPeriodEnd && <p className="text-2xs text-signal-amber">Your subscription is scheduled to end at the current period boundary.</p>}
              </div>
            ) : (
              <p className="text-xs leading-5 text-ink-500">Membership details are not available yet. Confirm the database migration has been applied and refresh this panel.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {status?.portalEnabled ? <Button size="sm" onClick={() => void manageBilling()} disabled={busy}>Manage subscription ↗</Button> : <Badge tone="warn">Stripe portal not configured</Badge>}
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_.8fr]">
          <Panel title={mode === 'signin' ? 'Welcome back' : 'Create your Sonora account'} right={<Badge tone="accent">Supabase Auth</Badge>}>
            <form className="space-y-3" onSubmit={(event) => void submit(event)}>
              <label className="block"><span className="mb-1.5 block text-xs text-ink-400">Email address</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-white/[.1] bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent/50" placeholder="you@example.com" /></label>
              <label className="block"><span className="mb-1.5 block text-xs text-ink-400">Password</span><input required minLength={8} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-white/[.1] bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition focus:border-accent/50" placeholder="At least 8 characters" /></label>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
            </form>
            <div className="mt-4 border-t border-white/[.07] pt-3 text-xs text-ink-500">
              {mode === 'signin' ? 'New to Sonora? ' : 'Already have an account? '}
              <button type="button" className="text-accent hover:text-white" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null); }}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</button>
            </div>
          </Panel>
          <Panel title="Why create an account?">
            <ul className="space-y-3 text-xs leading-5 text-ink-400">
              <li><span className="text-accent">01</span> Keep your membership and billing status connected to one identity.</li>
              <li><span className="text-accent">02</span> Track monthly AI allowances and future usage-based services.</li>
              <li><span className="text-accent">03</span> Manage payment methods and subscriptions through Stripe's customer portal.</li>
            </ul>
            <p className="mt-4 text-2xs leading-5 text-ink-600">Account creation does not move local projects or audio into cloud storage. That migration is a separate feature and requires an explicit import flow.</p>
          </Panel>
        </div>
      )}
    </div>
  );
}
