# Hosted service: plans and Stripe (Milestone 6)

This applies only to the hosted instance (app.consyrion.com) and to anyone who runs CONSYRION AI as a service.
Self-hosted installations set `SELF_HOSTED=true` and have no plans (docs/self-hosting.md).

## Pricing of app.consyrion.com (owner decision 05.11.26)
| Plan | Price | Limits |
|---|---|---|
| Free (`starter`) | 0 € | 2 council runs per month, up to 3 models, 3 projects, advice only (no GitHub build) |
| Pro (`pro`) | 4.99 € / month incl. VAT | unlimited council runs, up to 6 models, build on GitHub (Execution Council), 3 members |

The values live in the `plan_definition` table on the server (migration 0029 set them). Users cannot change them;
the platform admin changes them in `/admin` → Plan catalog. Limits of 1,000,000 or more are shown as "unlimited".

## Business model: platform subscription + BYOK
Binding product decision (issue #30): Consyrion is **strictly BYOK**. Customers connect their own Anthropic,
OpenAI or Google keys and pay AI usage to those providers. Consyrion never resells tokens, has no AI credits,
wallets or top-ups, and never falls back to an operator-owned key. The brief's mention of "managed AI credits"
is superseded by this decision.

A key deleted or no longer decryptable during a run stops only the model that uses it: its call is recorded as an
error, the token reservation is released, and the model is marked failed with the reason "No usable API key for
<provider>: …" (UI, report and log). The council continues if at least two models remain; another key is never
used in its place (test: "stops only the model whose key is deleted during the run", `packages/council/test/engine.test.ts`).

Consyrion charges a **platform subscription** (hosting, database, workers, sandbox, storage, operations).

## Plans and entitlements
- Catalog `starter | pro | developer | business` seeded from `DEFAULT_PLAN_CATALOG` (`packages/core/src/plans.ts`)
  and editable by the platform admin (`/admin`): name, price label, Stripe price id, limits, active.
- Limits enforced server-side (`assertEntitlement`): members incl. open invitations, active projects, council
  sessions per month, models per session, Execution Council availability and runs per month, sandbox minutes,
  GitHub integration.
- No active subscription → Starter. `past_due`/`canceled` subscriptions fall back to Starter.

## Usage transparency
`/settings/billing` shows platform usage against the limits and observed AI tokens per model (calls, failures,
input/output tokens). An approximate cost appears only for models where the workspace entered its own price;
the provider invoice is authoritative.

## Stripe
**Set up from `/admin` → "Stripe and Pro price"** (same approach as OnJam): paste the secret key (`sk_test_…` for the
sandbox, `sk_live_…` for real money) and the monthly price. The server checks the key and creates at Stripe: product
"CONSYRION AI Pro", a monthly EUR price with `tax_behavior=inclusive`, the webhook to `/api/billing/webhook` and a
customer portal configuration (cancel at period end, payment method, invoices). Key and webhook secret are stored
encrypted in `platform_setting` (`CREDENTIALS_MASTER_KEY_*`) and never shown again; the Pro plan gets the new price
id and label. Changing the price later needs no key: a new Stripe price is created and the old one archived, running
subscriptions keep their price. Before live sales: VAT registration/OSS and Stripe Tax, legal pages, payout account.

Alternatively `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in the environment enable Checkout (subscription mode)
and the customer portal; the admin setup takes precedence.
Webhook `/api/billing/webhook` verifies `Stripe-Signature` (5 min tolerance) and applies
`customer.subscription.created|updated|deleted`. Without these variables nothing can be charged; the admin
assigns plans manually. Stripe test mode keys are recommended until launch.

## Team
Invitation links (no e-mail is sent): valid 7 days, bound to the invited address, count as a seat, revocable.
Owners grant any role; admins can manage members and viewers only. The last owner cannot leave or be demoted.
Workspace switcher under *Workspace*.

## Privacy (#31)
- JSON export of all workspace data (owner) without secrets.
- Permanent deletion of a project or of the whole workspace with name confirmation; cascades through all
  tenant tables. Audit events record exports and deletions.
- Provider keys can be rotated (re-encrypted, validation reset) and revoked.

## Platform admin
`PLATFORM_ADMIN_EMAILS` (comma-separated). `/admin` returns 404 for everybody else.
