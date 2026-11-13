# Hosted service: plans and Stripe (Milestone 6)

This applies only to the hosted instance (app.consyrium.com) and to anyone who runs CONSYRIUM AI as a service.
Self-hosted installations set `SELF_HOSTED=true` and have no plans (docs/self-hosting.md).

## Pricing of app.consyrium.com (owner decision 05.11.26)

| Plan             | Price                    | Limits                                                                                 |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Free (`starter`) | 0 €                      | 2 council runs per month, up to 3 models, 3 projects, advice only (no GitHub build)    |
| Pro (`pro`)      | 4.99 € / month incl. VAT | unlimited council runs, up to 6 models, build on GitHub (Execution Council), 3 members |

The values live in the `plan_definition` table on the server (migration 0029 set them). Users cannot change them;
the platform admin changes them in `/admin` → Plan catalog. Limits of 1,000,000 or more are shown as "unlimited".

## Business model: platform subscription + BYOK

Binding product decision (issue #30): Consyrium is **strictly BYOK**. Customers connect their own Anthropic,
OpenAI or Google keys and pay AI usage to those providers. Consyrium never resells tokens, has no AI credits,
wallets or top-ups, and never falls back to an operator-owned key. The brief's mention of "managed AI credits"
is superseded by this decision.

A key deleted or no longer decryptable during a run stops only the model that uses it: its call is recorded as an
error, the token reservation is released, and the model is marked failed with the reason "No usable API key for
<provider>: …" (UI, report and log). The council continues if at least two models remain; another key is never
used in its place (test: "stops only the model whose key is deleted during the run", `packages/council/test/engine.test.ts`).

Consyrium charges a **platform subscription** (hosting, database, workers, sandbox, storage, operations).

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
the provider invoice is authoritative. Since QA 12.11.26 an empty cost cell says "enter price" and jumps to the price form
(`#price-hints`) instead of a bare "–" that read as free; no price is ever invented. The plan price stored by the Stripe
setup ("4.99 € / month") is shown in the page language ("4,99 € pro Monat"); a label the admin typed by hand stays as
written, and a free plan no longer reads "Free · Free".

**Prompt cache (#244).** Every call also records how many of its input tokens the provider served from its prompt
cache (`usage_record.cached_input_tokens`: Anthropic `cache_read_input_tokens`, OpenAI `cached_tokens`, Gemini
`cachedContentTokenCount`, OpenAI-compatible providers `prompt_tokens_details.cached_tokens`). Input tokens always
include the cached ones – Anthropic reports them separately, the adapter adds them – so budgets count every token
once. Billing shows the cached share per model ("of which cached"), a council's header shows it under the used
tokens. Cached tokens are usually billed at a fraction of the input price; the price hint does not discount them
yet. This is the measurement step: making the repository context cacheable (a stable prompt prefix) follows
separately.

## Stripe

**Set up from `/admin` → "Stripe and Pro price"** (same approach as OnJam): paste the secret key (`sk_test_…` for the
sandbox, `sk_live_…` for real money) and the monthly price. The server checks the key and creates at Stripe: product
"CONSYRIUM AI Pro", a monthly EUR price with `tax_behavior=inclusive`, the webhook to `/api/billing/webhook` and a
customer portal configuration (cancel at period end, payment method, invoices). Key and webhook secret are stored
encrypted in `platform_setting` (`CREDENTIALS_MASTER_KEY_*`) and never shown again; the Pro plan gets the new price
id and label. Changing the price later needs no key: a new Stripe price is created and the old one archived, running
subscriptions keep their price. Before live sales: VAT registration/OSS and Stripe Tax, legal pages, payout account.

Alternatively `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in the environment enable Checkout (subscription mode)
and the customer portal; the admin setup takes precedence.
Webhook `/api/billing/webhook` verifies `Stripe-Signature` (5 min tolerance) and applies
`customer.subscription.created|updated|deleted`. Stripe may deliver events late, twice or out of order, so the handler
does not trust the snapshot in the event: it reads the subscription's current state from the Stripe API
(`GET /v1/subscriptions/:id`) and applies that (#407) – an old "active" retried after "deleted" cannot reactivate a
plan. A failed lookup answers 500 and Stripe retries. Without these variables nothing can be charged; the admin
assigns plans manually. Stripe test mode keys are recommended until launch.

## Upgrade and back to Free (08.11.26)

- **Upgrade entry in the sidebar:** "Auf Pro upgraden" (→ `/settings/billing#plans`) appears above the workspace card
  only when the workspace is on the free plan (`starter`), online checkout is open (`onlineCheckoutOpen`: Stripe
  configured, a live key only with final legal pages) and the user may manage billing (`billing:manage`). After the
  upgrade it disappears; members without billing rights never see it.
- **Back to Free on the billing page:** for a Stripe subscription the free plan shows "Zurück zu Free". It opens the
  customer portal directly at the cancellation step (`/api/billing/portal` with `{ "flow": "cancel" }`, Stripe
  `flow_data[type]=subscription_cancel`). The portal cancels at the period end, so the paid month stays usable; once the
  webhook arrives the page shows "Zurück zu Free am …" and the plan card "endet am …" (#337).
- A plan the platform admin assigned by hand (provider `manual`) cannot be cancelled online; the page asks the user to
  get in touch instead.
- **Back from Stripe before the webhook:** Stripe redirects at once, the webhook often follows seconds later, and the
  app layout (sidebar upgrade entry) is not re-rendered on client navigation. So after `?checkout=success` (while the
  plan is still Free) and after the portal (`?portal=return`) the billing page refreshes itself every 2 s for at most
  30 s (`RefreshUntilSettled`); after a successful checkout it stops as soon as the plan has changed.

## Team

Invitation links (no e-mail is sent): valid 7 days, bound to the invited address, count as a seat, revocable.
Owners grant any role; admins can manage members and viewers only. The last owner cannot leave or be demoted.
Workspace switcher under _Workspace_.

## Privacy (#31)

- JSON export of all workspace data (owner) without secrets.
- Permanent deletion of a project or of the whole workspace with name confirmation; cascades through all
  tenant tables. Audit events record exports and deletions.
- Provider keys can be rotated (re-encrypted, validation reset) and revoked.

## Platform admin

`PLATFORM_ADMIN_EMAILS` (comma-separated). `/admin` returns 404 for everybody else. With SMTP configured (e-mail
verification on, see `docs/security.md`) the admin address must also be verified.

## Legal pages (05.11.26)

`/impressum`, `/agb`, `/datenschutz` (German, public, linked in the landing footer and on sign-up). The operator data
lives in `apps/web/src/lib/legal.ts` (`OPERATOR`): the hosted service names only "CONSYRIUM AI" as operator (owner decision
11.11.26). While a value still
contains a `[placeholder]`, every legal page shows a draft notice – fill them in before live Stripe sales.
Self-hosted operators replace `OPERATOR` with their own data. Container logs are size-limited in
`deploy/hetzner/compose.yml` (10 MB × 3 per service), as the privacy policy states.

### Stripe customer unknown to the connected account (07.11.26)

After switching from test to live keys, a workspace can still hold a test-mode customer id. "Manage subscription" then
failed with "No such customer". The portal now recognises Stripe's `resource_missing` (param `customer`), forgets the
stale customer and subscription ids, marks the subscription as manually assigned – plan and status are unchanged – and
explains this in the interface language. Checkout does the same and retries once without the customer, so Stripe
creates a new one from the e-mail address.

### Cancellation at the period end (07.11.26)

The Stripe portal cancels "at period end": a customer who cancels keeps the paid plan until `current_period_end`; only
`customer.subscription.deleted` moves the workspace to the default plan. The webhook stores `cancel_at_period_end`
(also `cancel_at`) as `subscription.cancel_at_period_end` (migration 0035), and the billing page then says
"Cancelled – your plan stays active until …" instead of "Renews on …". Undoing the cancellation in the portal clears it.
