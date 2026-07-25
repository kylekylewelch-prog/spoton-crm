<div align="center">

<img src="public/logo.svg" alt="SpotOn — Revenue Operating System" width="420" />

**A SaaS revenue operating system, not a contact tracker.**

Accounts and hierarchies · pipeline with enforced stage gates · quoting with escalating discount approvals · subscriptions with co-termination · automatic renewals · an immutable ARR ledger · explainable customer health · service with entitlement-driven SLAs · partners and channel · and an MCP server so Claude can work the same data under the same permissions.

</div>

---

## What this is

Most CRMs can tell you who you spoke to and what stage a deal is in. Very few can tell you what ARR was added, expanded, contracted or lost last quarter, which customers will renew, or whether bookings reconcile to subscriptions and billing. SpotOn is built around those questions.

Two rules drive the design, and both are enforced by code and covered by tests:

1. **Winning a deal creates its renewal immediately.** Closing an opportunity as won books the order, writes the contract, provisions the subscription and its entitlements, records the ARR movement, and creates the renewal record *and* its paired renewal opportunity dated at term end. A renewal that only exists as a report someone remembers to run is a renewal nobody owns.

2. **A mid-term upsell co-terms, and its full annual value reaches the renewal.** Add 40 seats four months before the term ends and three things happen together: the addition is snapped to the parent subscription's end date so the account keeps one renewal event, only the stub period is invoiced, and the *full annual* value is added to the next open renewal's renewable ARR — with the uplift recalculated on the larger base. Doing any one of those without the others either gives the customer two renewal dates or quietly loses the expansion at renewal.

Every money figure is integer cents and every rate is integer basis points, so the ARR waterfall sums to the penny. The test suite asserts that the movement ledger equals the sum of account ARR after every single transition.

## Quick start

No database server required. PGlite is real Postgres compiled to WebAssembly, so the whole thing runs from a clone.

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Then open <http://localhost:3000> and sign in as `admin@spoton.dev` / `spoton`.

`db:setup` resets, migrates and seeds. The seed is worth understanding: it drives the **real services** for every commercial path — quotes go through the approval chain, deals are won through the stage gate, subscriptions are provisioned by the booking engine, mid-term upsells are co-termed by the amendment engine, tickets run through the SLA engine. It is an end-to-end exercise of the business logic, not a pile of hand-written rows.

### Sign in as different roles

Every seeded account uses the password `spoton`. Switching roles is the fastest way to see object permissions, record scope and field-level security take effect.

| Login | Role | What changes |
| --- | --- | --- |
| `admin@spoton.dev` | Administrator | Everything, including gate overrides |
| `ae@spoton.dev` | Account Executive | 10% discount authority; can only write their own records; potential ARR read-only |
| `renewals@spoton.dev` | Renewal Manager | Renewal desk and amendments |
| `csm@spoton.dev` | Customer Success Manager | Health, risks, success plans |
| `dealdesk@spoton.dev` | Deal Desk | Quoting, price books, approvals |
| `support@spoton.dev` | Support Engineer | Tickets; deal amounts and quote totals hidden entirely |
| `cro@spoton.dev` | CRO | Forecast and approvals |
| `marketing@spoton.dev` | Marketing Ops | Campaigns, attribution, routing rules |

## Running against real Postgres

The same schema and migrations apply unchanged.

```bash
docker compose up -d postgres
# in .env
DATABASE_URL=postgres://spoton:spoton@localhost:5432/spoton
npm run db:setup
```

## The MCP server for Claude

Claude gets a first-class, governed surface over the CRM. It runs **as a real SpotOn user** — by default the `integration@spoton.dev` service account — so object permissions, record scope, field-level security and the audit trail apply exactly as they do in the browser. There is no privileged back door.

```bash
npm run mcp          # stdio, for Claude Desktop and Claude Code
```

For Claude Code, `.mcp.json` in the repo root is picked up automatically. For Claude Desktop, copy the `mcpServers` block from `claude_desktop_config.example.json`. There is also an authenticated HTTP transport at `POST /api/mcp` guarded by `MCP_API_TOKEN`, for hosted deployments.

**Read tools** — `spoton_search`, `spoton_get_account` (the 360 view), `spoton_pipeline`, `spoton_inspect_opportunity`, `spoton_renewals`, `spoton_arr_movement`, `spoton_at_risk`, `spoton_meeting_prep`, `spoton_query`, `spoton_describe_object`, `spoton_insights`, `spoton_price_quote`.

**Write tools** — `spoton_log_activity`, `spoton_create_task`, `spoton_update_opportunity`, `spoton_advance_stage`.

The write set is deliberately narrow. There is no tool to approve a discount, book revenue, or churn a subscription, because those decisions need a human and an audit row. `spoton_advance_stage` cannot bypass a stage gate: when criteria are unmet it reports exactly what is outstanding and changes nothing. `spoton_price_quote` prices without persisting.

Things worth asking Claude once it is connected:

- *"Which renewals in the next 90 days are at risk, and why?"*
- *"Inspect the Meridian Retail deal and tell me what is blocking it."*
- *"Prepare me for tomorrow's call with Kestrel Health."*
- *"Price 200 Enterprise seats at 28% off co-termed onto their current subscription — what approvals would that need?"*
- *"What ARR did we add, expand, contract and lose last quarter?"*

## Architecture

```
src/
  domain/      Pure functions. No database, no framework. All the arithmetic.
  db/          Drizzle schema (73 tables), migrations, deterministic seed.
  server/      Auth, RBAC, audit, the object registry, the repository, services.
  mcp/         Tool definitions, stdio server, JSON Schema conversion.
  app/         Next.js App Router: workspaces plus generated object screens.
```

### The domain layer is where correctness lives

`src/domain` holds the engines as pure, dependency-free functions: pricing and proration, co-termination, the discount approval matrix, ARR movement classification and the retention waterfall, renewal planning and risk, health scoring, lead scoring and routing, attribution, forecasting, SLA timers and the workflow engine. They are unit-tested in isolation, which is why the money is trustworthy.

A few decisions worth calling out, because they are the ones that usually go wrong:

- **Proration is computed from exact day counts, in one step.** Rounding a ratio to whole basis points first loses real cents on large amounts. Whole contractual years bill at the annual rate regardless of leap days, and only genuine stub periods prorate.
- **What is billed now is never more than a year.** Co-terming onto a multi-year subscription can leave 900 days on the term; that value is real, but it belongs in TCV, not in the amount invoiced today.
- **Gross retention is capped at 100% by construction; net can exceed it.** Both measure the opening balance of the existing base, so new ARR won in the period is excluded — including it flatters net retention and hides a leaky base.
- **A price rise with no quantity change is uplift, not expansion,** so pricing power is measurable separately from volume growth.
- **A flat renewal produces no ARR movement at all,** rather than a churn-plus-new pair.
- **Sourced credit is exclusive; influenced credit is inclusive.** Influenced pipeline legitimately sums to more than total pipeline, which is exactly why the two can never share a column.
- **Approval chains escalate rather than jumping.** A 35% discount collects manager, VP and CRO, so each level sees what it approved. Non-standard paper always draws deal desk regardless of price, because the risk in those deals is rarely the price.
- **Health renormalises around missing inputs** instead of scoring them zero, and reports the shortfall as reduced confidence. An account with no telemetry is unmeasured, not unhealthy.

### Objects are configuration, not code

`src/server/objects.ts` describes all 73 objects once — fields, types, relationships, validation, list columns, related lists. The REST-ish API, the generic list, detail, create and edit screens, the validation layer, the reporting layer and the MCP tools are all generated from that metadata. Adding an entry gives an object an API, a UI, security, reporting and an MCP surface without touching any of those layers.

That is what makes custom objects first-class rather than extra tables, and it is why the smoke test can walk 73 list pages, 73 create forms and 72 detail and edit pages.

### Security is three independent layers

Collapsing them is how CRMs end up granting edit rights to everyone who needs to read something.

1. **Object level** — may this role touch quotes at all?
2. **Record level** — is this account theirs, their team's, or in their territory? Read is deliberately wider than write throughout.
3. **Field level** — may they see the ARR column, and may they change it? Hidden fields are removed from the payload entirely, not masked in the UI, and column headers respect it too.

Ownership is never a bare pointer. Every change writes effective-dated `ownership_history`, closing the previous holder's row the day before the new one opens, because replacing an owner field without dated history makes historical attainment and commission unreconstructable.

## Testing

```bash
npm run verify       # typecheck + unit + integration + smoke
```

- **374 unit and integration tests.** The domain engines are tested in isolation; the integration suite runs against a real Postgres database via PGlite, seeded through the production code paths.
- **308 end-to-end smoke checks.** Boots the production build, signs in through the documented session API, and asserts every workspace, object list, create form, detail page and edit page renders, that unauthenticated access is refused, and that both MCP transports behave.

The test worth reading is `tests/integration/lifecycle.test.ts`: it quotes a deal, escalates it through a two-step approval chain, blocks the requester from approving their own discount, refuses to accept an unapproved quote, wins the deal, verifies the subscription, entitlements, order, contract and renewal were provisioned, applies a co-termed mid-term cross-sell, checks that the annual value was rolled into the renewal with the uplift recalculated, renews at the uplifted rate, and churns another subscription — asserting the ARR ledger reconciles exactly at every step.

## Theme

The palette and typographic posture follow the Third Man Records house style: a near-black ground, one saturated signature yellow doing all the emphatic work, a single red reserved for alarm, warm letterpress off-white for text, hard 90-degree edges everywhere, heavy condensed uppercase display type, and visible hairline rules instead of shadows and soft cards. The values are an interpretation of that identity rather than sampled from the site, which is a JavaScript-rendered storefront. Light and dark themes are both supported; the toggle sits in the sidebar.

The mark is a struck target — the outer ring broken where the shot went through — which is as close to a visual pun on "spot on" as seemed defensible.

## What lives here, and what does not

SpotOn owns the authoritative operational view of account and contact relationships, lifecycle and ownership, engagement and campaign-response history, opportunities and pipeline, quotes and commercial approvals, contracts and subscriptions, ARR movements, renewals and expansions, customer risks and success actions, and forecasts.

Detailed billing transactions, general-ledger data, raw product events and revenue recognition stay in the systems built for them. SpotOn receives summarised metrics, changes, scores and signals — enough for someone to make a decision and act. `src/server/services/integrations.ts` implements the plumbing for that exchange for real: durable outbox rows, idempotency keys, a bounded retry ladder with exponential backoff, a dead-letter queue a human can see, stable external ids and sync monitoring. Fifteen provider adapters are simulated; swapping one for a live credential changes the transport, not the architecture.

## Notes and limitations

Worth stating plainly rather than discovering later:

- **The AI layer is deterministic heuristics, not a model.** Every insight ships with its evidence and a confidence figure, and nothing is applied to a record automatically — the interface would accept a real model's output unchanged, and the contract is the evidence, not the mechanism.
- **Document numbering derives from row counts.** Fine for a single writer; a deployment under concurrent load should move it to a Postgres sequence per document type.
- **PGlite is single-process.** Two processes cannot open the same data directory, so use real Postgres for anything beyond local development.
- **Jobs are functions, not a scheduler.** `scoreAllAccounts`, `refreshRenewalRisk`, `detectSignals`, `takeSnapshots`, `sweepLeadSlaBreaches`, `sweepCaseSlaBreaches` and `processRetryQueue` are ready to call; wire them to cron, a queue, or a scheduled function.
- **There is an unrelated payments company called SpotOn.** The name here is used for an internal revenue platform and is not affiliated with it.

## Licence

MIT. See [LICENSE](LICENSE).
