-- Sonora billing foundation.
-- Run with Supabase migrations. Server-only tables are not exposed to browser roles.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.billing_customers enable row level security;
revoke all on table public.billing_customers from anon, authenticated;
grant all on table public.billing_customers to service_role;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  plan_key text not null check (plan_key in ('creator', 'pro', 'studio')),
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_period_idx
  on public.subscriptions (user_id, current_period_end desc);
alter table public.subscriptions enable row level security;
revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
grant all on table public.subscriptions to service_role;
drop policy if exists "Users can view their own subscriptions" on public.subscriptions;
create policy "Users can view their own subscriptions"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.stripe_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
grant all on table public.stripe_events to service_role;

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null unique,
  operation text not null,
  credits integer not null check (credits > 0),
  source text not null default 'monthly' check (source in ('monthly', 'purchased')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null check (status in ('reserved', 'captured', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_credit_ledger_user_period_idx
  on public.ai_credit_ledger (user_id, period_start, period_end, status);
alter table public.ai_credit_ledger enable row level security;
revoke all on table public.ai_credit_ledger from anon, authenticated;
grant all on table public.ai_credit_ledger to service_role;

create table if not exists public.ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text unique,
  credits integer not null check (credits in (100, 500, 1500)),
  status text not null check (status in ('pending', 'paid', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_credit_purchases_user_status_idx
  on public.ai_credit_purchases (user_id, status);
alter table public.ai_credit_purchases enable row level security;
revoke all on table public.ai_credit_purchases from anon, authenticated;
grant all on table public.ai_credit_purchases to service_role;

-- Reserve one credit atomically before a connected AI request. Reservations count
-- against the allowance to prevent concurrent requests overspending a user's quota.
create or replace function public.reserve_ai_credit(
  p_user_id uuid,
  p_operation text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plan text := 'free';
  v_limit integer := 10;
  v_month_used integer := 0;
  v_purchased_used integer := 0;
  v_purchased_total integer := 0;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_source text := 'monthly';
  v_existing public.ai_credit_ledger%rowtype;
begin
  if p_user_id is null or length(coalesce(p_request_id, '')) < 8 or length(p_request_id) > 160 then
    raise exception 'Invalid credit reservation request';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select * into v_existing
  from public.ai_credit_ledger
  where request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'ok', v_existing.status in ('reserved', 'captured'),
      'duplicate', true,
      'status', v_existing.status,
      'credits', v_existing.credits,
      'source', v_existing.source
    );
  end if;

  select s.plan_key, s.current_period_start, s.current_period_end
    into v_plan, v_period_start, v_period_end
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.status in ('active', 'trialing')
    and s.current_period_start <= now()
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1;

  if not found then
    v_plan := 'free';
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
  end if;

  v_limit := case v_plan
    when 'creator' then 100
    when 'pro' then 400
    when 'studio' then 1200
    else 10
  end;

  select coalesce(sum(l.credits), 0)::integer into v_month_used
  from public.ai_credit_ledger l
  where l.user_id = p_user_id
    and l.period_start = v_period_start
    and l.period_end = v_period_end
    and l.source = 'monthly'
    and l.status in ('reserved', 'captured');

  select coalesce(sum(l.credits), 0)::integer into v_purchased_used
  from public.ai_credit_ledger l
  where l.user_id = p_user_id
    and l.source = 'purchased'
    and l.status in ('reserved', 'captured');

  select coalesce(sum(p.credits), 0)::integer into v_purchased_total
  from public.ai_credit_purchases p
  where p.user_id = p_user_id and p.status = 'paid';

  if v_month_used < v_limit then
    v_source := 'monthly';
  elsif v_purchased_used < v_purchased_total then
    v_source := 'purchased';
  else
    return jsonb_build_object(
      'ok', false,
      'plan', v_plan,
      'allowance', v_limit,
      'used', v_month_used,
      'remaining', 0,
      'purchased_remaining', greatest(v_purchased_total - v_purchased_used, 0),
      'period_end', v_period_end
    );
  end if;

  insert into public.ai_credit_ledger (
    user_id, request_id, operation, credits, source, period_start, period_end, status
  ) values (
    p_user_id, p_request_id, left(coalesce(p_operation, 'assistant'), 64), 1,
    v_source, v_period_start, v_period_end, 'reserved'
  );

  return jsonb_build_object(
    'ok', true,
    'plan', v_plan,
    'source', v_source,
    'allowance', v_limit,
    'used', v_month_used + case when v_source = 'monthly' then 1 else 0 end,
    'remaining', greatest(v_limit - v_month_used - case when v_source = 'monthly' then 1 else 0 end, 0),
    'purchased_remaining', greatest(v_purchased_total - v_purchased_used - case when v_source = 'purchased' then 1 else 0 end, 0),
    'period_end', v_period_end
  );
end;
$$;

create or replace function public.capture_ai_credit(p_request_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.ai_credit_ledger
  set status = 'captured', updated_at = now()
  where request_id = p_request_id and status = 'reserved'
  returning true;
$$;

create or replace function public.release_ai_credit(p_request_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.ai_credit_ledger
  set status = 'released', updated_at = now()
  where request_id = p_request_id and status = 'reserved'
  returning true;
$$;

revoke all on function public.reserve_ai_credit(uuid, text, text) from public, anon, authenticated;
revoke all on function public.capture_ai_credit(text) from public, anon, authenticated;
revoke all on function public.release_ai_credit(text) from public, anon, authenticated;
grant execute on function public.reserve_ai_credit(uuid, text, text) to service_role;
grant execute on function public.capture_ai_credit(text) to service_role;
grant execute on function public.release_ai_credit(text) to service_role;
