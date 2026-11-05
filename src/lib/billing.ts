import { getAuthAccessToken } from './auth';

export type PlanKey = 'free' | 'creator' | 'pro' | 'studio';
export type BillingInterval = 'month' | 'year';

export interface BillingStatus {
  authConfigured: boolean;
  stripeConfigured: boolean;
  billingConfigured: boolean;
  configuredPlans: Record<string, { monthly: boolean; yearly: boolean }>;
  creditPacksConfigured: Record<string, boolean>;
  creditTopupsConfigured: boolean;
}

export interface Entitlements {
  authenticated: boolean;
  email?: string;
  plan: PlanKey;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  aiCredits: { allowance: number; used: number; remaining: number; periodEnd: string; purchased: { total: number; used: number; remaining: number } };
}

async function apiRequest<T>(path: string, options: RequestInit = {}, requireAuth = false): Promise<T> {
  const token = requireAuth ? await getAuthAccessToken() : null;
  if (requireAuth && !token) throw new Error('Sign in to continue.');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Billing request failed (${response.status}).`);
  return payload;
}

export function getBillingStatus() {
  return apiRequest<BillingStatus>('/api/billing/status');
}

export function getEntitlements() {
  return apiRequest<Entitlements>('/api/billing/entitlements', {}, true);
}

export async function startCheckout(plan: Exclude<PlanKey, 'free'>, interval: BillingInterval) {
  const result = await apiRequest<{ url: string }>(
    '/api/billing/checkout',
    { method: 'POST', body: JSON.stringify({ plan, interval, requestId: crypto.randomUUID() }) },
    true,
  );
  if (!result.url || !result.url.startsWith('https://')) throw new Error('The billing server returned an invalid checkout URL.');
  window.location.assign(result.url);
}

export async function startCreditCheckout(credits: '100' | '500' | '1500') {
  const result = await apiRequest<{ url: string }>(
    '/api/billing/credits/checkout',
    { method: 'POST', body: JSON.stringify({ credits: Number(credits), requestId: crypto.randomUUID() }) },
    true,
  );
  if (!result.url || !result.url.startsWith('https://')) throw new Error('The billing server returned an invalid credit checkout URL.');
  window.location.assign(result.url);
}

export async function openBillingPortal() {
  const result = await apiRequest<{ url: string }>('/api/billing/portal', { method: 'POST', body: '{}' }, true);
  if (!result.url || !result.url.startsWith('https://')) throw new Error('The billing server returned an invalid customer portal URL.');
  window.location.assign(result.url);
}
