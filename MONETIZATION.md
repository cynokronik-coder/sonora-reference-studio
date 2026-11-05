# Sonora monetization: product and production plan

## Current implementation status

The repository now contains the **first real account, recurring-billing and paid AI credit top-up integration**, alongside the Plans & Add-ons commercial UI.

Implemented in code:
- Supabase email/password sign-up, sign-in, session refresh and sign-out in the Account screen.
- Server-side Supabase session verification before billing and account endpoints.
- Stripe Checkout Session creation for the Creator, Pro and Studio subscription plans, with the plan and billing interval resolved from server environment variables.
- Stripe customer creation and customer-portal session creation.
- Raw-body Stripe webhook signature verification, duplicate-event recording, and subscription status synchronization.
- A Supabase migration for billing customers, subscriptions, Stripe events, a private monthly/purchased AI-credit ledger and top-up purchase records, with restrictive grants and row-level security.
- Atomic server-side AI-credit reservations use included monthly credits first, then verified purchased top-ups. Successful calls are captured and failed provider requests release their reservation. In production, connected AI refuses to run until Supabase identity/usage controls are configured.
- Pricing buttons connect to Stripe Checkout only when the server settings and browser Supabase public key are present. Existing paid users are sent to the billing portal.
- One-time 100, 500 and 1,500-credit packs have Stripe Checkout routes. Credits are added only after a verified payment webhook; a refund webhook revokes the associated pack.

Still not live until the owner configures services:
- Supabase project keys and migration.
- Stripe account secret, six recurring subscription Price IDs, three credit-pack Price IDs, webhook secret and customer-portal configuration.
- Auth redirect URLs, Stripe test-mode validation, production domain and deployment environment.

Still roadmap:
- Preset/course marketplace catalogue and fulfilment.
- Human-reviewed mastering order workflow.
- Affiliate attribution, commission reversals and payouts.
- Team seats, roles and shared cloud projects.

The application does not include customer credentials or Stripe/Supabase secrets. The repository branch is code-complete for the initial integration but has not been connected to a live Supabase or Stripe account.

**Important entitlement boundary:** the only paid usage limit currently enforced by the server is connected AI assistant credits (included monthly allowance plus purchased top-ups). Sonora's local DSP, analysis, project creation and offline export remain available across plans. Per-plan project limits, advanced-feature gates, cloud storage, collaboration and priority queues are not yet implemented. Do not sell those as active paid entitlements.

Checkout, top-up and customer-portal endpoints also require the explicit server environment flag `SONORA_BILLING_ENABLED=true`. It defaults to false in `.env.example`; leave it false until test-mode validation and the release gates below are complete.

## Proposed pricing hypotheses

All values below are starting points for customer research. They are not live offers and must be validated against actual support, hosting, payment, tax and AI costs.

| Plan | Monthly | Annual | Included AI credits / month | Project limit | Monthly mastering allowance |
|---|---:|---:|---:|---:|---:|
| Free | €0 | €0 | 10 | 3 | Preview only |
| Creator | €12.90 | €129 | 100 | 15 | 10 |
| Pro | €24.90 | €249 | 400 | Unlimited | 50 |
| Studio | €49.90 | €499 | 1,200 | Unlimited | 150 |

The annual price is presented as roughly two months free compared with twelve monthly payments. Before public sale, decide whether displayed prices include French VAT, make the VAT treatment explicit, and review consumer, invoicing and cancellation requirements for every target market.

Pro is the proposed default plan to emphasize, but the free plan should remain useful. In particular, local audio playback, deterministic DSP editing and offline processing should not be artificially charged as AI consumption.

### One-time add-ons

| Add-on | Proposed price |
|---|---:|
| 100 AI credits | €3.90 |
| 500 AI credits | €14.90 |
| 1,500 AI credits | €34.90 |
| Preset packs | €4.90–€19.90 |
| Human-reviewed mastering | €29–€99 / track |
| Education products | €19–€79 |

### Studio and partner concepts

- Studio/team: €79–€149 per month, dependent on seats, shared storage, role controls and support requirements.
- Standard affiliate: 20% recurring commission.
- Creator partner: 25% recurring commission.
- Strategic partner: 30% recurring commission.

Commission percentages are proposals only. The programme needs written rules for attribution windows, eligibility, refunds, chargebacks, self-referrals, cookie consent, payout minimums, tax documentation and termination before it is opened.

## Billing implementation and production configuration

The existing app stores projects and audio in browser IndexedDB. Billing identity and subscription metadata are server-side, but audio/project cloud sync is not included. The following integration is implemented; it becomes operational after configuration.

### Supabase setup
1. Create a Supabase project.
2. Apply `supabase/migrations/20261105000100_billing_auth.sql` using the Supabase SQL Editor or the Supabase CLI.
3. In Auth URL configuration, allow the local URL `http://localhost:3000/#account` and your exact production redirect URL.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the frontend environment.
5. Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to the API server environment. The secret key must remain server-only. A legacy `SUPABASE_SERVICE_ROLE_KEY` JWT is supported during migration, but Supabase recommends the new secret key format.
6. Configure email confirmation and an SMTP sender in Supabase before inviting customers. Test sign-up, confirmation, sign-in, session refresh and sign-out.

### Stripe setup
1. Create six recurring Prices in Stripe: Creator monthly/yearly, Pro monthly/yearly and Studio monthly/yearly. Use the amounts displayed in the pricing page or adjust the product catalog before launch.
2. Add each Stripe Price ID to its corresponding server environment variable in `.env.example`.
3. Add `STRIPE_SECRET_KEY` to the API server (start with a test-mode key).
4. Create three one-time Prices for 100, 500 and 1,500 AI credits; set `STRIPE_PRICE_CREDITS_100`, `STRIPE_PRICE_CREDITS_500` and `STRIPE_PRICE_CREDITS_1500`.
5. Create a Stripe webhook endpoint pointing to `https://YOUR_DOMAIN/api/webhooks/stripe`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` and `charge.refunded`. Add the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
6. Configure the Stripe customer portal in the Stripe Dashboard with the plan changes, cancellations and payment-method updates you intend to allow.
7. Set `SONORA_APP_URL` to the exact public Sonora origin. Configure the API server and reverse proxy so the same-origin `/api/*` routes reach `server/index.mjs`.
8. Keep `SONORA_BILLING_ENABLED=false` while testing. After all test-mode payment, webhook, subscription, credit and refund checks pass and the paid-feature description is accurate, set `SONORA_BILLING_ENABLED=true` in the API server environment. The server independently rejects checkout and portal creation while the flag is false.

For local testing, use Stripe test-mode keys and the Stripe CLI to forward webhook events to `http://localhost:8787/api/webhooks/stripe`. Test recurring checkout, portal, renewal, failed-payment, cancellation and replayed events. Also test successful and failed credit-pack payments and a refunded top-up. The top-up grant is webhook-driven; do not grant credit from the Checkout success redirect.

The preferred server API key is Supabase's `sb_secret_...` key. It is sent only in the `apikey` header. A legacy `service_role` JWT is also supported and is sent as both the API key and bearer authorization. Never expose either elevated key to the browser.

### 1. Identity and project ownership

Choose and configure an identity provider. Every server request must authenticate the user and derive the user ID from a verified token; never trust a user ID submitted in a request body.

For a hosted product, move account-owned project metadata and private audio references to server-side storage. Every project, asset, export, preset purchase and team resource must have an ownership or membership check. Keep private audio private and use signed, expiring object-storage URLs.

### 2. Stripe subscriptions

Create Stripe Products and Prices for each plan and billing interval. Store Stripe Price IDs in server-side environment variables or a trusted database catalog; do not trust an amount or price ID sent by the browser.

Recommended checkout flow:
1. Authenticated user selects a plan in Sonora.
2. Server verifies the user's identity and the requested plan key.
3. Server resolves the permitted Stripe Price ID from its own catalog.
4. Server creates a Stripe Checkout Session with the authenticated user ID in metadata and a stable idempotency key.
5. Stripe redirects the customer to its hosted checkout.
6. A signed webhook updates the subscription record.
7. Sonora reads current entitlements from the server, never from the checkout success URL.

Required subscription events include checkout completion, subscription created/updated/deleted, invoice paid and invoice payment failed. Verify the Stripe webhook signature against the raw request body. Make webhook handling idempotent and safe to replay.

Add a Stripe Customer Portal route for plan changes, cancellation and payment-method updates. Resolve the Stripe customer from a server-side user-to-customer mapping.

### 3. Server-side entitlements

Represent features as entitlements, not only visual frontend locks. Example keys:

- `projects.max`
- `mastering.renders_per_period`
- `ai.credits_per_period`
- `reference_match.level`
- `processing.advanced`
- `exports.advanced`
- `support.priority`
- `team.seats`

The frontend can display a plan comparison, but the server must enforce every paid limit at the operation that consumes it. Local DSP features should remain available independently from cloud AI entitlements.

### 4. AI credit ledger

Use an append-only ledger rather than updating a single number with no audit history. Each charge should record:
- user ID and operation type;
- credit amount and timestamp;
- request/idempotency ID;
- outcome (reserved, captured, released or refunded);
- provider cost metadata where appropriate.

Reserve credits before an expensive AI operation, capture only after successful completion, and release failed reservations. Define the cost of each operation from measured provider costs and target gross margin; do not assume every AI call has the same cost. Set monthly allowances from the active subscription period. Make top-up expiration and refund treatment explicit.

Never charge credits for local playback, deterministic audio processing or local analysis unless the product changes materially and the reason is transparent.

### 5. Preset and education marketplace

Use a product catalog with product IDs, versions, descriptions, creator, price, license and delivery asset. After verified payment, grant a durable entitlement to the purchased version and provide a secure download or in-app library entry. Handle refunds and chargebacks by revoking access where the terms require it. Confirm the rights to distribute every preset, sample, tutorial and course asset.

### 6. Human-reviewed mastering service

This is a service workflow, not just a product card. It needs an order record, secure file transfer, explicit delivery expectations, engineer assignment, status tracking, revisions, customer support and refund/dispute handling. Do not advertise a guaranteed turnaround or result until there is an operational engineer network.

### 7. Affiliate attribution and payouts

Store referral clicks and attribution server-side with consent-aware tracking. Link a referred account to an eligible affiliate once, according to published attribution rules. Calculate commissions from verified paid invoices, then reverse or adjust them for refunds, disputes and chargebacks. Keep a commission ledger and use a controlled payout process; do not calculate or pay commissions from browser events.

### 8. Team accounts

Team plans need an organization record, seats, invitations, roles, membership checks and shared project ownership. Add organization-level usage limits and billing administration. Do not expose shared projects until every API route checks both organization membership and the relevant role.

## Suggested minimum data model

A relational database should contain, at minimum:

- `users`: identity-provider subject, email, created time.
- `stripe_customers`: user ID, Stripe customer ID.
- `subscriptions`: user ID, Stripe subscription ID, Price ID, status, current period and cancellation state.
- `entitlements`: plan key, feature key, value and version.
- `usage_ledger`: user ID, operation, amount, status, idempotency key and timestamps.
- `marketplace_products`: SKU, category, creator, version, price and active status.
- `purchases`: user ID, SKU, Stripe Checkout Session/payment reference, delivery status and refund state.
- `referrals`: affiliate ID, referred user ID, attribution metadata and eligibility.
- `commissions`: invoice reference, gross basis, commission rate, amount and reversal state.
- `payouts`: affiliate ID, amount, provider reference, status and audit timestamps.
- `organizations` and `memberships`: team ownership, seat count, roles and invitation state.

Use unique constraints for Stripe event IDs, checkout sessions, invoice references and idempotency keys. Add retention/deletion rules for personal data and user audio.

## Environment configuration to plan for

Names are illustrative until the identity provider and database are selected:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_CREATOR_MONTHLY`
- `STRIPE_PRICE_CREATOR_YEARLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PRO_YEARLY`
- `STRIPE_PRICE_STUDIO_MONTHLY`
- `STRIPE_PRICE_STUDIO_YEARLY`
- `DATABASE_URL`
- identity-provider issuer, audience and JWKS configuration
- private object-storage credentials and bucket configuration

All secrets must remain server-side. Never put Stripe secret keys, webhook secrets, database credentials or identity-provider secrets in a `VITE_*` variable or commit them to Git.

## Release gates

Do not enable public checkout until all of these are true:

- Identity verification and per-user ownership checks are implemented and tested.
- Database persistence, backups, deletion and migration procedures are in place.
- Stripe test-mode checkout, portal, webhooks, retries and idempotency pass automated tests.
- Entitlements and AI credit limits are enforced server-side.
- Failed AI jobs release reservations; refunds and chargebacks reconcile correctly.
- Marketplace fulfillment and affiliate commission reversals are tested.
- Privacy notice, terms, cancellation/refund policies, VAT presentation and customer support process are ready.
- Rate limits, abuse controls, observability and incident procedures exist.
- A production deployment has persistent storage; no local JSON file or browser storage is used as the source of truth for paid entitlements.

## Recommended delivery order

1. Authentication, database and server-side ownership.
2. Stripe products, subscriptions, webhooks and customer portal.
3. Server-side entitlements and AI credit ledger.
4. Credit top-ups.
5. Preset marketplace and digital fulfillment.
6. Team workspaces.
7. Affiliate attribution and payouts.
8. Human-reviewed mastering and education services.

This order puts recurring revenue and reliable access control first, then adds the more operationally complex marketplace and partner programmes.
