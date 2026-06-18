# SCH_HANDOFF_v20 — BUILDVSPLAN terminal · Billing Triage + 90-Day Cash-Flow Forecast

**Repo:** sch-command (cross-app: reads sales-command-owned `invoices`/`customers`/`billing_schedule`/`proposals`/`billing_schedule_pay_apps`/`tenant_config`) · branch `feat/billing-forecast`
**Author:** Terminal #4 of 4 — buildvsplan (`/buildvsplan`)
**Date:** 2026-06-18
**Plan checked:** `docs/plans/billing_forecast_integration.md`
**Build reviewed at:** `7a00c74` (the commit handed to me) · **re-verified clean at** `770c603`

The 4-terminal pipeline this round: **#1 plan → #2 audit → #3 build → #4 buildvsplan (me)**. T1's v18 has the product decisions; T2's v19 has the adversarial convergence story. This is the **gate terminal's perspective** — the view from the one seat that reviews the *built code against the live system*, not the plan. My through-line: a plan can be proven correct (T2 did that) and the code can still not match it, and the only way to know is to read the running database, not the migration files ([[feedback_buildvsplan_gate]]). Companion to v18/v19, not a replacement.

---

## 1. What this terminal is (and why it's a different instrument than the audit)

The audit (T2) reviewed the **plan**, read-only, before code existed — "is this safe to build from?" I review the **built code + the live DB**, read-only, *after* build and *before* Chris smoke tests — "does the code actually match the plan, and does the schema it assumes actually exist?" Same adversarial posture, different target and different moment. A build can faithfully write the app layer against a schema or a spec that was never fully shipped — it compiles, the UI renders, and nothing works. Catching that is the entire reason this seat exists.

Hard rules I held: no edits, no commits to source/migrations/configs, no `db push`/deploy/migration-repair, **read-only DB probes only** (PostgREST `select=…&limit=1` column-existence checks — never INSERT/UPDATE/DELETE/DDL). A gate that also patches isn't a gate — I produced a punch-list and handed it back; the build terminal closed it.

---

## 2. The signature move only this terminal makes: the live-schema reality check

This is the differentiator. "It's in the migration file" is **not** proof it's in the database. The §6.5/E2 deploy path for this repo is manual (dashboard SQL editor + `migration repair`, because `db push` can't run against the shared ledger) — which is exactly the setup where a migration file ships in the branch but the table never reaches prod, and every `setBillingWorklistFlag`/`loadBillingWorklist` call dies at runtime. So I probed the real DB off `.env.local`'s anon key.

**What the probe proved (all green):**

- **`billing_worklist` is actually deployed, not just filed.** All 7 columns (`id`, `job_id`, `hold_sales`, `hold_reason`, `nothing_to_bill`, `terms_override`, `chris_notes`) return `200`. The migration `20260618120000` was applied — the `41f4305` commit message "(NOT yet applied)" was stale by the time I checked. **This was the single highest-leverage unknown** and it cleared: the worklist's only write target exists, so the manual-flag layer works.
- **Every canonical column the forecast reads exists live** — all 14 `invoices` columns (incl. `discount`, `retention_amount`, `retention_release_of`, `proposal_id`, `voided_at`, `deleted_at`), plus `proposals.{total,is_archive_proposal,status}`, `billing_schedule.contract_sum`, `billing_schedule_pay_apps.{status,submitted_at,invoice_id}`, `tenant_config.default_billing_terms`.
- **The exact embedded select** from `loadInvoicesForForecast` (`invoices → call_log → customers → tenant_config` nested resources) returns `200` end-to-end. The forecast's real query path is live, not just its flat columns.

**The one yellow flag, run to ground so the next terminal doesn't re-chase it:** a *direct, unauthenticated* `customers?select=billing_terms` returns `500` — body `57014 canceling statement due to statement timeout`. That is **not** a missing column and **not** an RLS leak; it's an anon full-table scan against `customers`' tenant-scoped policy timing out with no `auth.uid()`. The path the app actually uses — the authenticated embedded join through `invoices` — returns `200`. Informational, not a blocker. Don't "fix" it.

**Takeaway for the pipeline:** file-present ≠ deployed, and the only honest way to close that gap is to query the live system. T2 proved the RLS *read* was safe statically; I proved the *schema it reads* is actually there. Different proofs, both needed.

---

## 3. What the gate caught against the built code (and the plan↔audit loop could not)

The plan converged to "the math is correct" (T2's verdict, and I confirmed it line-by-line — net formula, fully-billed arithmetic, `authoritative_total` selection, resolution order/N3, expected-pay-date precedence/C4, past-due bucket/C5+N6, hybrid completion arms §8.1c, `loadAllRows` signature/N5). But "the plan is correct" is not "the code matches the plan." Against `7a00c74` I found **3 Tier-2s — 0 Tier-1** — all in the *execution*, none in the math:

1. **N9 $0-net suppression missing from the worklist** (`billingForecast.js`). The forecast suppressed `net <= 0` invoices, but the **actionable worklist** surface condition did not — a fully-retained/discounted job would surface as a noise Needs-Triage row. A genuine [LOCKED §3.4] spec miss that only shows up when you read the *surface condition*, not the formula.
2. **Billing Report export still read the retired `billing_log` percent** (`exports.js:110` / `printBillingReport`). Census site #3 (§5.2a) said re-point or retire; neither was done — the export would print frozen placeholder percent while billing lives on `/billing`.
3. **`jobs.billed_to_date` percent input survived** (`Schedule.jsx:763`). The auto-writers were correctly gone, but an editable 0–100 percent field remained a live write source — N10 says leave no live percent source.

None block runtime; all three are "renders, but drifts from the new source-of-truth." That's the classic class the plan-time audit structurally can't see, and the buildvsplan gate exists to.

**Status now:** the build terminal fixed all three in **`5141ed0`** ("fix 3 Tier-2 findings from T4 buildvsplan"), and I **re-verified them closed on the current tree (`770c603`)**: N9 suppression is live (`billingForecast.js:295–305`, `nothingCollectable` guard reusing `sentInvoices`/`remaining`), `printBillingReport` is deleted (`exports.js:106`), the `Schedule.jsx` input is gone. The gate did its job and the punch-list is closed.

---

## 4. What I deliberately did NOT do

- **Did not fix anything myself.** Gate, not fixer ([[feedback_buildvsplan_gate]]). I handed the 3-item punch-list back; the build terminal owns the close (`5141ed0`). A gate that patches stops being a gate.
- **Did not run any write against the DB.** Column-existence probes only (`limit=1`). No INSERT/UPDATE/DDL, no `migration repair`, no deploy — even though I confirmed the table is live, *confirming* deployment and *performing* it are different jobs and only one is mine.
- **Did not touch the uncommitted `docs/BACKLOG.md` modification** in the working tree — it isn't this terminal's change (a parallel session's, same note T2 flagged in v19). This handoff commit touches **only `SCH_HANDOFF_v20.md`** ([[feedback_parallel_session_collisions]]).
- **Did not re-open the [LOCKED] decisions or re-find T1/T2 issues.** My scope was code-vs-plan + live-schema, full stop.

---

## 5. Honest boundary: the moving tree, and what "GO" means

I was handed `7a00c74`; by the time I wrote this the branch had advanced to `770c603` (the `5141ed0` fixes + T1's v18 + T2's v19 handoffs) — parallel terminals were live. So read the timeline straight: **my 3 findings were real against `7a00c74`, were fixed in `5141ed0`, and are verified closed on `770c603`.** They are not open items; they are the gate's audit trail.

My verdict is **smoke-test GO**: 0 Tier-1 blockers, schema proven live, the 3 Tier-2s closed and re-checked. What "GO" does **not** mean: it is not a smoke test. I proved the code matches the plan and the schema exists — I did not click through the running app. The forecast rendering against real HDSP invoice rows, the worklist population firing on the right jobs, the manual-flag writes round-tripping through `setBillingWorklistFlag` → `job_changes` — those are the smoke test's to confirm, not mine.

---

## 6. State at this terminal's close (for T31's closeout)

- **Gate verdict:** GO. 0 Tier-1 · 3 Tier-2 (found at `7a00c74`, fixed `5141ed0`, re-verified `770c603`) · 0 open from this pass.
- **Live schema:** `billing_worklist` deployed (7/7 cols `200`); all 27 canonical read-columns + the embedded forecast select probe `200`. The `customers` direct-select `500` is an anon statement-timeout, not a defect — do not chase.
- **Only remaining deferral by design:** `JobDetail.jsx:76` keeps a **read-only** `billing_log` history view (census site #4 — plan explicitly keeps it read-only, ADJ-7 narrowed to just this). Not a miss; intentional.
- **Migration ledger note for whoever pushes:** the table is live in the DB, but confirm it's recorded in `supabase_migrations.schema_migrations` via `migration repair --status applied 20260618120000` so future collision checks stay honest (§6.5). I verified the table *exists*; I did not verify the *ledger row* (can't, via PostgREST).
- **Next gate:** smoke test (§0 click-path: `/jobs` → money tiles → `/billing` two-tab). Then the merge/push decision — branch is `ahead 2` of origin with a parallel-session `docs/BACKLOG.md` edit still uncommitted; resolve that ownership before any push.

— T4 (buildvsplan), out.
