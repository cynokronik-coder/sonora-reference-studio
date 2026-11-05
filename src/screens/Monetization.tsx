import { useEffect, useState } from 'react';
import { getAuthSession, isSupabaseAuthConfigured, subscribeToAuth, type AuthSession } from '../lib/auth';
import { getBillingStatus, getEntitlements, openBillingPortal, startCheckout, startCreditCheckout, type BillingStatus, type Entitlements, type PlanKey } from '../lib/billing';

type Section = 'plans' | 'credits' | 'marketplace' | 'partners';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    description: 'A real way to explore Sonora before subscribing.',
    monthly: 0,
    annual: 0,
    annualTotal: 0,
    credits: '10 AI credits',
    projects: '3 projects',
    mastering: 'Preview only',
    features: ['Core audio import and playback', 'Basic audio analysis', 'Local DSP processing', '3 saved projects', 'Reference-match preview', 'Community learning resources'],
    cta: 'Included',
  },
  {
    key: 'creator',
    name: 'Creator',
    description: 'For independent artists building a consistent workflow.',
    monthly: 12.9,
    annual: 10.75,
    annualTotal: 129,
    credits: '100 AI credits / month',
    projects: '15 projects',
    mastering: '10 AI assists / month',
    features: ['Everything in Free', '10 mastering renders per month', 'Reference Match tools', 'Preset library access', 'Advanced export options', 'Export tools for release workflows'],
    cta: 'Creator plan',
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'For producers who want deeper control and repeatable results.',
    monthly: 24.9,
    annual: 20.75,
    annualTotal: 249,
    credits: '400 AI credits / month',
    projects: 'Unlimited projects',
    mastering: '50 AI assists / month',
    features: ['Everything in Creator', '50 mastering renders per month', 'Advanced processing chains', 'Extended AI assistant allowance', 'Priority processing', 'Advanced reference workflows'],
    cta: 'Choose Pro',
    popular: true,
  },
  {
    key: 'studio',
    name: 'Studio',
    description: 'For professional rooms and high-volume production work.',
    monthly: 49.9,
    annual: 41.58,
    annualTotal: 499,
    credits: '1,200 AI credits / month',
    projects: 'Unlimited projects',
    mastering: '150 AI assists / month',
    features: ['Everything in Pro', '150 mastering renders per month', 'Higher AI usage allowance', 'Priority support queue', 'Studio-oriented usage limits', 'Team features as they become available'],
    cta: 'Studio plan',
  },
] as const;

const CREDIT_PACKS = [
  { credits: '100', price: '€3.90', note: 'For occasional AI assistance' },
  { credits: '500', price: '€14.90', note: 'For regular project work' },
  { credits: '1,500', price: '€34.90', note: 'For intensive AI-assisted sessions' },
];

const MARKET_ITEMS = [
  { tag: 'PRESET MARKETPLACE', title: 'Production & mastering packs', price: '€4.90–€19.90', copy: 'Curated EQ, vocal, dynamics and genre-oriented starting points. Presets remain editable and are never presented as one-click guarantees.' },
  { tag: 'PRO SERVICES', title: 'Human-reviewed mastering', price: '€29–€99 / track', copy: 'An optional hand-off to a vetted engineer for a listening-based review and mastering service. This is a planned service, not an active order flow.' },
  { tag: 'SONORA ACADEMY', title: 'Mixing and mastering courses', price: '€19–€79', copy: 'Practical lessons, workflow guides and reference-matching education for producers who want to understand their decisions.' },
];

const COMPARISON = [
  ['Audio import & playback', '✓', '✓', '✓', '✓'],
  ['Basic DSP processing', '✓', '✓', '✓', '✓'],
  ['Basic audio analysis', '✓', '✓', '✓', '✓'],
  ['Saved projects', '3', '15', 'Unlimited', 'Unlimited'],
  ['AI mastering assists', 'Preview', '10 / month', '50 / month', '150 / month'],
  ['AI credits', '10', '100 / month', '400 / month', '1,200 / month'],
  ['Reference Match', 'Preview', '✓', '✓', '✓'],
  ['Advanced processing chains', '—', 'Limited', '✓', '✓'],
  ['Advanced export', '—', '✓', '✓', '✓'],
  ['Priority processing', '—', '—', '✓', '✓'],
  ['Team collaboration', '—', '—', 'Planned', 'Planned'],
];

const money = (value: number) => new Intl.NumberFormat('en-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);

function SectionButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3.5 py-2 text-xs transition ${active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/[.07] bg-white/[.025] text-ink-400 hover:border-white/15 hover:text-white'}`}
    >
      {children}
    </button>
  );
}

function StatusNote({ children }: { children: string }) {
  return <div className="rounded-xl border border-signal-amber/20 bg-signal-amber/[.06] px-3 py-2.5 text-2xs leading-relaxed text-amber-100/80">{children}</div>;
}

export default function Monetization({ onOpenAccount }: { onOpenAccount: () => void }) {
  const [section, setSection] = useState<Section>('plans');
  const [annual, setAnnual] = useState(true);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [busyCreditPack, setBusyCreditPack] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

  const refreshAccount = async (active: AuthSession | null) => {
    if (active) {
      try { setEntitlements(await getEntitlements()); }
      catch { setEntitlements(null); }
    } else {
      setEntitlements(null);
    }
  };

  useEffect(() => {
    let alive = true;
    void getBillingStatus().then((status) => { if (alive) setBillingStatus(status); }).catch(() => { if (alive) setBillingStatus(null); });
    void getAuthSession().then((active) => {
      if (!alive) return;
      setSession(active);
      void refreshAccount(active);
    });
    const unsubscribe = subscribeToAuth((active) => {
      if (!alive) return;
      setSession(active);
      void refreshAccount(active);
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const billingReady = Boolean(billingStatus?.billingConfigured && isSupabaseAuthConfigured());

  const choosePlan = async (plan: Exclude<PlanKey, 'free'>) => {
    setBillingError(null);
    setBillingMessage(null);
    if (!session) {
      onOpenAccount();
      return;
    }
    setBusyPlan(plan);
    try {
      if (entitlements && entitlements.plan !== 'free') {
        await openBillingPortal();
      } else {
        await startCheckout(plan, annual ? 'year' : 'month');
      }
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : 'Could not start checkout.');
      setBusyPlan(null);
    }
  };

  const purchaseCredits = async (credits: '100' | '500' | '1500') => {
    setBillingError(null);
    setBillingMessage(null);
    if (!session) {
      onOpenAccount();
      return;
    }
    setBusyCreditPack(credits);
    try {
      await startCreditCheckout(credits);
    } catch (cause) {
      setBillingError(cause instanceof Error ? cause.message : 'Could not start credit checkout.');
      setBusyCreditPack(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-white/[.07] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="section-label">Sonora membership</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-white sm:text-3xl">Make room for your next record.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-400">Choose the workspace that fits your production rhythm. Local audio processing stays useful on every plan; subscriptions add higher limits and connected services.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] ${billingReady ? 'border-accent/25 bg-accent/[.07] text-accent' : 'border-signal-amber/25 bg-signal-amber/[.07] text-signal-amber'}`}>{billingReady ? 'Billing configured' : 'Billing setup required'}</span>
          <button type="button" onClick={onOpenAccount} className="rounded-lg border border-white/[.1] px-3 py-2 text-xs text-ink-300 transition hover:border-accent/30 hover:text-white">{session ? session.user.email : 'Sign in / Create account'}</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SectionButton active={section === 'plans'} onClick={() => setSection('plans')}>Plans & pricing</SectionButton>
        <SectionButton active={section === 'credits'} onClick={() => setSection('credits')}>AI credits</SectionButton>
        <SectionButton active={section === 'marketplace'} onClick={() => setSection('marketplace')}>Marketplace</SectionButton>
        <SectionButton active={section === 'partners'} onClick={() => setSection('partners')}>Studios & partners</SectionButton>
      </div>

      {section === 'plans' && (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Straightforward plans</h2>
              <p className="mt-1 text-xs text-ink-500">Illustrative launch pricing in euros. Final limits and VAT presentation should be confirmed before launch.</p>
            </div>
            <div className="inline-flex w-fit items-center gap-1 rounded-xl border border-white/[.08] bg-black/20 p-1">
              <button type="button" onClick={() => setAnnual(false)} className={`rounded-lg px-3 py-2 text-xs ${!annual ? 'bg-ink-700 text-white' : 'text-ink-500 hover:text-white'}`}>Monthly</button>
              <button type="button" onClick={() => setAnnual(true)} className={`rounded-lg px-3 py-2 text-xs ${annual ? 'bg-accent text-[#10150a]' : 'text-ink-500 hover:text-white'}`}>Yearly · 2 months free</button>
            </div>
          </div>

          {billingError && <div role="alert" className="rounded-xl border border-signal-red/25 bg-signal-red/[.06] px-4 py-3 text-xs text-signal-red">{billingError}</div>}
          {billingMessage && <div role="status" className="rounded-xl border border-accent/20 bg-accent/[.06] px-4 py-3 text-xs text-accent">{billingMessage}</div>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((plan) => {
              const price = annual ? plan.annual : plan.monthly;
              return (
                <article key={plan.key} className={`relative flex flex-col rounded-2xl border p-4 shadow-panel ${'popular' in plan && plan.popular ? 'border-accent/45 bg-gradient-to-b from-accent/[.09] to-[#101318]' : 'border-white/[.08] bg-[#101318]/90'}`}>
                  {'popular' in plan && plan.popular && <span className="absolute -top-2.5 right-4 rounded-full bg-accent px-2.5 py-1 font-mono text-[8px] font-semibold uppercase tracking-[.12em] text-[#10150a]">Most popular</span>}
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[.16em] text-ink-500">{plan.name}</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">{plan.name}</h3>
                    <p className="mt-1 min-h-[42px] text-xs leading-5 text-ink-400">{plan.description}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-semibold tracking-[-.05em] text-white">{price === 0 ? '€0' : money(price)}</span>
                      <span className="text-xs text-ink-500">/ month</span>
                    </div>
                    {annual && plan.key !== 'free' ? (
                      <p className="mt-1 text-2xs text-ink-500">{money(plan.annualTotal)} billed yearly</p>
                    ) : (
                      <p className="mt-1 text-2xs text-ink-500">{plan.key === 'free' ? 'No payment required' : 'Billed monthly'}</p>
                    )}
                  </div>
                  <div className="my-4 space-y-2 border-y border-white/[.07] py-3 text-2xs text-ink-300">
                    <div className="flex justify-between gap-2"><span className="text-ink-500">AI allowance</span><span className="text-right">{plan.credits}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-500">Projects</span><span>{plan.projects}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-500">Mastering</span><span>{plan.mastering}</span></div>
                  </div>
                  <ul className="mb-5 flex-1 space-y-2">
                    {plan.features.map((feature) => <li key={feature} className="flex gap-2 text-2xs leading-relaxed text-ink-300"><span className="text-accent">✓</span><span>{feature}</span></li>)}
                  </ul>
                  {plan.key === 'free' ? (
                    <div className="w-full rounded-lg border border-white/[.08] bg-white/[.025] px-3 py-2.5 text-center text-xs font-medium text-ink-400">{entitlements?.plan === 'free' ? 'Your current plan' : 'Free plan'}</div>
                  ) : (
                    <button
                      type="button"
                      disabled={!billingReady || busyPlan !== null}
                      onClick={() => void choosePlan(plan.key)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${'popular' in plan && plan.popular ? 'border-accent/40 bg-accent text-[#10150a] hover:bg-[#d5fa7a]' : 'border-white/[.1] bg-white/[.045] text-white hover:border-accent/35'}`}
                      title={!billingReady ? 'Configure Supabase and Stripe server credentials and all Price IDs to enable checkout.' : !session ? 'Sign in to subscribe.' : 'Continue to secure Stripe Checkout.'}
                    >
                      {busyPlan === plan.key ? 'Opening secure checkout…' : entitlements && entitlements.plan !== 'free' ? 'Manage subscription' : !billingReady ? 'Billing setup required' : session ? 'Choose ' + plan.name : 'Sign in to subscribe'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#101318]/80">
            <div className="border-b border-white/[.07] px-4 py-3"><h3 className="text-sm font-semibold text-white">Plan comparison</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead><tr className="bg-white/[.025] text-ink-400"><th className="px-4 py-3 font-medium">Included</th><th className="px-3 py-3 font-medium">Free</th><th className="px-3 py-3 font-medium">Creator</th><th className="px-3 py-3 font-medium text-accent">Pro</th><th className="px-3 py-3 font-medium">Studio</th></tr></thead>
                <tbody>{COMPARISON.map((row) => <tr key={row[0]} className="border-t border-white/[.055]"><th className="px-4 py-2.5 font-medium text-ink-300">{row[0]}</th>{row.slice(1).map((value, i) => <td key={i} className={`px-3 py-2.5 ${i === 2 ? 'text-accent' : 'text-ink-400'}`}>{value}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          {billingReady ? (
            <div className="rounded-xl border border-accent/20 bg-accent/[.05] px-3 py-2.5 text-2xs leading-relaxed text-accent">Supabase authentication and Stripe billing credentials are configured. Sign in to start a secure Checkout Session. Subscription access is activated only after Stripe sends a verified webhook.</div>
          ) : (
            <StatusNote>Checkout stays disabled until Supabase Auth, the server-side service-role key, Stripe secret and webhook keys, and all six monthly/yearly Stripe Price IDs are configured. The app will not accept or simulate payments without them.</StatusNote>
          )}
        </section>
      )}

      {section === 'credits' && (
        <section className="space-y-5">
          <div className="max-w-2xl"><p className="section-label">Usage-based AI</p><h2 className="mt-2 text-xl font-semibold text-white">Keep expensive AI work predictable.</h2><p className="mt-2 text-sm leading-6 text-ink-400">Monthly allowances are reserved for AI analysis and assistant requests. Local audio playback, DSP processing and offline rendering should not consume AI credits.</p></div>
          <div className="grid gap-3 md:grid-cols-3">
            {CREDIT_PACKS.map((pack) => <article key={pack.credits} className="rounded-2xl border border-white/[.08] bg-[#101318] p-5"><p className="font-mono text-[9px] uppercase tracking-[.16em] text-ink-500">Top-up pack</p><div className="mt-3 flex items-baseline gap-2"><span className="text-3xl font-semibold text-white">{pack.credits}</span><span className="text-xs text-ink-500">credits</span></div><p className="mt-2 text-sm text-ink-300">{pack.price}</p><p className="mt-1 text-2xs text-ink-500">{pack.note}</p><button
            type="button"
            disabled={!billingStatus?.creditTopupsConfigured || !isSupabaseAuthConfigured() || busyCreditPack !== null}
            onClick={() => void purchaseCredits(pack.credits.replace(',', '') as '100' | '500' | '1500')}
            className="mt-5 w-full rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-xs text-ink-300 transition hover:border-accent/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >{busyCreditPack === pack.credits.replace(',', '') ? 'Opening checkout…' : billingStatus?.creditTopupsConfigured ? session ? 'Buy credits' : 'Sign in to buy' : 'Credit checkout setup required'}</button></article>)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[.08] bg-[#101318] p-4"><h3 className="text-sm font-semibold text-white">What should consume credits?</h3><ul className="mt-3 space-y-2 text-xs text-ink-400"><li>• AI track analysis and interpretation</li><li>• Reference-based AI recommendations</li><li>• Conversational assistant requests</li><li>• AI-assisted processing-chain proposals</li></ul></div>
            <div className="rounded-2xl border border-white/[.08] bg-[#101318] p-4"><h3 className="text-sm font-semibold text-white">What should stay unlimited?</h3><ul className="mt-3 space-y-2 text-xs text-ink-400"><li>• Local audio import and playback</li><li>• Built-in DSP and processor editing</li><li>• Offline rendering within plan limits</li><li>• Project editing and local measurements</li></ul></div>
          </div>
          <StatusNote>Included monthly allowances are tracked on the server. Credit packs are fulfilled only after a verified Stripe payment webhook; configure the three credit-pack Price IDs to enable purchases. Local playback, DSP processing and offline rendering never consume AI credits.</StatusNote>
        </section>
      )}

      {section === 'marketplace' && (
        <section className="space-y-5">
          <div className="max-w-2xl"><p className="section-label">Beyond subscriptions</p><h2 className="mt-2 text-xl font-semibold text-white">A production marketplace around the studio.</h2><p className="mt-2 text-sm leading-6 text-ink-400">One-off purchases let customers add value when they need it, without forcing every service into a recurring plan.</p></div>
          <div className="grid gap-3 lg:grid-cols-3">
            {MARKET_ITEMS.map((item, index) => <article key={item.title} className="flex flex-col rounded-2xl border border-white/[.08] bg-[#101318] p-5"><p className="font-mono text-[9px] tracking-[.16em] text-accent">{item.tag}</p><h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-ink-400">{item.copy}</p><div className="mt-5 border-t border-white/[.07] pt-4"><p className="text-sm font-medium text-white">{item.price}</p><p className="mt-1 text-2xs text-ink-500">{index === 0 ? 'Proposed one-time purchase' : 'Planned service · not orderable yet'}</p><button type="button" disabled className="mt-4 w-full cursor-not-allowed rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2 text-xs text-ink-500">Catalogue not connected</button></div></article>)}
          </div>
          <StatusNote>The marketplace is a product specification preview. No preset packs, engineers or courses are currently being sold through Sonora.</StatusNote>
        </section>
      )}

      {section === 'partners' && (
        <section className="space-y-5">
          <div className="max-w-2xl"><p className="section-label">Scale with your network</p><h2 className="mt-2 text-xl font-semibold text-white">Built for studios and creator partnerships.</h2><p className="mt-2 text-sm leading-6 text-ink-400">A future team tier and recurring affiliate programme can turn Sonora into a tool that grows through working producers and educators.</p></div>
          <div className="grid gap-3 lg:grid-cols-[1.05fr_.95fr]">
            <article className="rounded-2xl border border-white/[.08] bg-[#101318] p-5">
              <p className="font-mono text-[9px] tracking-[.16em] text-accent">STUDIO / TEAM</p>
              <h3 className="mt-3 text-xl font-semibold text-white">One workspace for a small production team.</h3>
              <div className="mt-4 flex items-baseline gap-2"><span className="text-3xl font-semibold text-white">€79–€149</span><span className="text-xs text-ink-500">/ month · proposed</span></div>
              <ul className="mt-5 space-y-2 text-xs text-ink-300"><li>✓ Multiple seats and role-based access</li><li>✓ Shared projects and version history</li><li>✓ Centralized billing and usage limits</li><li>✓ Shared preset collections</li><li>✓ Team-level administration</li></ul>
              <button type="button" disabled className="mt-6 w-full cursor-not-allowed rounded-lg border border-white/[.08] bg-white/[.035] px-3 py-2.5 text-xs text-ink-500">Team accounts not connected</button>
            </article>
            <article className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[.08] to-[#101318] p-5">
              <p className="font-mono text-[9px] tracking-[.16em] text-accent">SONORA PARTNERS</p>
              <h3 className="mt-3 text-xl font-semibold text-white">Earn by introducing producers to Sonora.</h3>
              <p className="mt-2 text-sm leading-6 text-ink-400">Proposed recurring commission tiers for educators, creators and strategic partners.</p>
              <div className="mt-5 space-y-3">
                {[['Standard affiliate','20% recurring'],['Creator partner','25% recurring'],['Strategic partner','30% recurring']].map(([label, rate]) => <div key={label} className="flex items-center justify-between border-b border-white/[.07] pb-2"><span className="text-xs text-ink-300">{label}</span><span className="text-xs font-semibold text-accent">{rate}</span></div>)}
              </div>
              <div className="mt-4 rounded-xl border border-white/[.08] bg-black/20 p-3"><p className="text-2xs leading-relaxed text-ink-400">Example only: 20% of a €24.90 Pro subscription is €4.98 per eligible paid month. Actual commission rules, attribution windows, refunds and payout terms must be defined before launch.</p></div>
              <button type="button" disabled className="mt-5 w-full cursor-not-allowed rounded-lg border border-accent/20 bg-accent/10 px-3 py-2.5 text-xs text-accent/60">Partner applications not connected</button>
            </article>
          </div>
          <StatusNote>Affiliate tracking, referral attribution, fraud checks, commission ledger and payouts are not active. Team seats also require sign-in and shared server-side project storage.</StatusNote>
        </section>
      )}

      <footer className="flex flex-col gap-2 border-t border-white/[.07] pt-4 text-2xs leading-relaxed text-ink-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Sonora Reference Studio · Commercial model preview</span>
        <span>Prices are proposed, not yet live offers. Confirm applicable VAT and terms before taking payments.</span>
      </footer>
    </div>
  );
}
