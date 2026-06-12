# Build 2 — Costs, Overage Stamp/Capture, Change-Order Workflow (Seed)

_Spawned from the SOW-vertical scope cut, 2026-06-12. This is the durable artifact the next planning loop starts from. The SOW pipeline (`docs/plans/sow_vertical.md`) ships first; everything here builds on top of it._

## §0 Status

**Seed only — not yet planned.** Spawned from the SOW-vertical scope cut 2026-06-12. Build after the SOW pipeline ships.

---

## §1 Purpose

Three pieces of work, deferred together from the SOW vertical because they all depend on cost data that the SOW pipeline does not yet carry:

1. **Costs visibility in Schedule** — the office can see, on a Schedule job, the cost of the scope as bid and the cost of any scope added downstream.
2. **Overage stamp + capture** — a reusable marker on the job plus a captured artifact row when a downstream add pushes committed cost beyond the bid. **Tag + capture only** (the full L5 design is in §2).
3. **The change-order workflow** — the downstream consumer of the overage stamps (CO proposal, re-pricing, customer approval). Still to be designed (§5).

**Hard dependency:** this build follows the SOW pipeline. It needs the canonical `job_wtcs` table written by Sales at send-time and the dated SOW shipping first. Do not start Build 2 until the SOW vertical ships and smoke-passes.

---

## §2 The L5 design [LOCKED — design stands, implementation deferred to Build 2 (2026-06-12)]

The locked design decision from `sow_vertical.md` §2 row L5:

> **Scope additions beyond bid** NEVER edit the proposal. They **stamp the job** with a reusable overage marker (a standard, reusable identifier, expected frequent) and **capture the artifact** (record that money was added beyond bid). The stamp is the future hook for a change-order workflow. **The change-order workflow itself is OUT OF SCOPE for the stamp/capture work — only the tag + capture.**

Core invariants this build must preserve (inherited from the SOW vertical's frozen-bid rule):

- **Frozen-bid invariant.** The proposal (`proposal_wtc` / `proposals.total`) is frozen at sale and is **never written downstream**. Scope and cost are immutable. Overage logic reads the bid; it never writes it.
- **Tag + capture only.** The stamp/capture work stops at writing the marker + artifact. It does not create a change order, re-price, or seek approval — that is §5, a separate downstream scope.
- **Money-OBSERVANT, not money-touching.** Overage is a **read-only compare** — frozen bid vs. committed cost — that writes **only an observation** (a flag + a record). It never writes money. Worst-case failure is a **wrong/missing flag** (a mis-observation), never financial corruption and never a lost scheduling edit.

---

## §3 The overage spec (cut from `sow_vertical.md` §8)

The full stamp + capture spec, preserved verbatim from the SOW-vertical plan so Build 2 starts from a real design, not a blank page.

### 3.1 Trip condition

A downstream add (a day, a material, a cost) that pushes the job's committed cost **beyond what was bid**. Detected in Schedule when an edit to `job_wtcs` (or `materials`) would exceed the frozen proposal total. The bid total is read from the frozen proposal — never recomputed against it.

**Cost-comparison basis [LOCKED 2026-06-11 — Chris ratified]:** committed `job_wtcs` cost vs. `proposals.total`, **accrual-style** (counted when work is committed, not when paid — mirrors the QB accrual rule). Stamp when committed cost > proposal total.

### 3.2 The reusable marker (the "stamp")

- A **standard, reusable** flag on the job. Recommended: a boolean + metadata on `jobs`: `jobs.has_overage boolean NOT NULL DEFAULT false`. It is the same identifier across all such jobs (L5: "unique identifier, standard across all such jobs, expected frequent"), and is the future hook a change-order workflow keys off.
- **Schedule-owned column → migration in sch-command, dashboard-applied** per the `sow_vertical.md` §6 / `CLAUDE.md` migration procedure.
- **Route the flag through the audit chokepoint.** Set the stamp via `updateJobField(jobId, 'has_overage', true, changedBy)` — **not** a raw `supabase.from('jobs').update({ has_overage: true })` — so the flag flip is audit-logged in `job_changes` like every other job write (`CLAUDE.md` critical rule). `updateJobField` already no-ops the audit insert when the value is unchanged, so re-stamping an already-flagged job won't spam the log.

### 3.3 The captured artifact (the record that money was added beyond bid)

A new Schedule-owned table `job_overages`:

```
id uuid PK default gen_random_uuid()
job_id int8 NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE
call_log_id int8           -- master-record key, mirrors the queries.js convention
kind text NOT NULL         -- 'day' | 'material' | 'cost'
description text
amount_over_bid numeric NOT NULL
created_by text            -- who
created_at timestamptz NOT NULL DEFAULT now()  -- when
```

+ 4 authenticated RLS policies scoped via `jobs.call_log_id → call_log.tenant_id` (copy the exact pattern from `20260512120100_job_wtcs_create.sql`). One row per overage event; the `jobs.has_overage` flag is set true on first insert.

**Migration note:** the `job_overages` table + 4 RLS policies and the `jobs.has_overage` boolean may be combined into one sch-command migration file. Both are Schedule-owned, dashboard-applied + ledger-repaired per the `sow_vertical.md` §6 procedure (NOT `db push` — see the `CLAUDE.md` RESUME ALERT).

### 3.4 Where the trip fires

- In the Schedule Field SOW editor (the SOW vertical's SCH1/SCH2 save path): on a save that adds a day/material whose cost exceeds the frozen bid, set `jobs.has_overage = true` and insert a `job_overages` row. **Do not block the save** (capture, don't gate) and **do not write `proposal_wtc`** (frozen-bid invariant).

### 3.5 The committed-cost SOURCE and best-effort-surfaced insert

- **The bid total (the comparand) is read READ-ONLY from the frozen proposal.** The canonical bid is the rolled-up `proposals.total`, but per sales-command **Data Integrity Rule 2** "`proposals.total` … can be stale"; the authoritative frozen per-WTC components live on `proposal_wtc` (the financial fields: `regular_hours, ot_hours, burden_rate, ot_burden_rate, markup_pct, materials, travel, discount, size`).
- **Committed cost (the other side)** = the accrual-style committed `job_wtcs` cost (§3.1 basis): counted when work is committed, not when paid.
- **Invariant reaffirmed:** no write path here touches any `proposal_wtc` financial field or `proposals.total`. The grep gate (no `from('proposal_wtc').update` in sch/field) covers this. This work is **money-observant, never money-touching**.
- **The `job_overages` insert is best-effort-surfaced (capture-don't-gate):** if either the `has_overage` stamp or the `job_overages` insert fails, it **surfaces an error to the user/log but NEVER rolls back or throws on the user's save**. The Schedule SOW save (the `job_wtcs.field_sow` / calendar write) **succeeds regardless** of whether the overage stamp/capture write succeeds. A failed stamp must not cost the user their scheduling edit.
- **Mirrors sales-command "fail-safe, not fail-silent" (Data Integrity Rule 6):** the failure is **logged/surfaced** (toast + console), not swallowed silently — the office should know the overage stamp didn't land — but the primary save is preserved. Concretely: run the SOW save first and confirm success; then attempt `updateJobField(jobId,'has_overage',true,...)` + `insert(job_overages)` in a try/catch that, on error, toasts "Saved — but couldn't record the overage flag" and logs the error, **without** reverting the SOW write or throwing.
- **Worst-case failure = a wrong/missing flag** (mis-observation), never financial corruption or a lost scheduling edit.

---

## §4 [DESIGN-OPEN] The pricing-plumbing decision (the crux of Build 2)

**This is the central undecided question of Build 2. Chris has NOT picked yet.**

**The problem:** Schedule needs the **cost of added scope WITHOUT manual entry**, but Schedule has no pricing engine. There is no `calcWtcPrice` / `burden_rate` / `markup_pct` anywhere in sch-command, and `job_wtcs` carries **no cost fields** — only scope (`field_sow`, work types, dates, `material_status`). So when an office user adds a day in Schedule, there is currently no way to know what that day costs, or whether it pushed the job past the bid, without someone typing a number.

**"No manual entry" is a hard requirement.** The overage trip (§3.1) needs a real committed-cost number, computed, not hand-entered.

Two options:

### Option 1 — carry costs forward onto `job_wtcs` at send

Sales already has the pricing engine and already writes `job_wtcs` at send-time (per the SOW vertical's S3). So at send, Sales **stamps the frozen per-WTC cost + rate fields onto the `job_wtcs` row**. Schedule then reads the stored numbers and prices an added day as simple arithmetic against the carried rates.

- **Pro:** Lighter. No new service. Schedule does arithmetic on numbers it already has locally.
- **Wrinkle:** pricing added **materials** needs more carried data than labor (a labor day prices off carried rates × hours × crew; a material add needs unit costs / markup that may not be fully captured by a per-WTC rate snapshot). Labor is clean; materials precision is the soft spot.

### Option 2 — a shared pricing service

An edge function in the shared backend that every driver calls. The pricing logic lives **once**; it serves AR and Field too, not just Schedule.

- **Pro:** Purer single-source-of-truth for pricing. Materials precision lives in one place. AR / Field can reuse it.
- **Con:** More upfront — a new service, a deploy surface, an API contract every caller depends on.

### Context that makes this decision valid

- The Command Suite is **ONE app across four repos** (silo-complexity, not a product boundary). Pulling pricing into Schedule, or standing up a shared service, are both "within one app" moves — not cross-product integration.
- The WTC cost data already lives in the **shared Supabase DB** (`pbgvgjjuhnpsumnowuym`) — both options read from the same source of truth, they differ on *where the math runs*.
- **"No manual entry" is a hard requirement** — both options must satisfy it; neither may fall back to asking the office to type a cost.

### Chris's lean (NOT decided — leave [DESIGN-OPEN])

Start with **Option 1** for the **bid-baseline + labor** (carry costs forward, price labor days as arithmetic), and **promote to Option 2** (shared pricing service) when **materials-precision** or **AR need** forces it. But this is a lean, not a ratification — the decision is open and belongs to the Build 2 planning loop.

---

## §5 The change-order workflow (Build 2 downstream scope — still to be designed)

The downstream consumer of the overage stamps. **Consumes the `job_overages` rows + `has_overage` flag** that §3 produces, and turns an observed overage into an actual change order:

- **CO proposal** — generate a change-order proposal for the added scope.
- **Re-pricing** — price the added scope (depends on §4's pricing-plumbing decision).
- **Customer approval** — route the CO for customer sign-off, mirroring the original proposal approval flow.

This is **still to be designed.** It is named here as Build 2's downstream scope so the planning loop knows the stamp/capture work (§3) is the upstream half and this is the half it unlocks. The frozen-bid invariant still holds: a change order is a **new** priced artifact, it does not edit the original frozen proposal.

---

## §6 Dependencies and sequencing (high level)

- **Depends on the SOW pipeline shipping first** — canonical `job_wtcs` (written by Sales at send), dated SOW, Field read. Do not start until that ships + smoke-passes.
- **§4 pricing-plumbing decision gates everything downstream** — the overage trip (§3) needs a committed-cost number, and the change-order workflow (§5) needs re-pricing. Resolve §4 early in the Build 2 planning loop.
- **Migrations** (`jobs.has_overage`, `job_overages`) are Schedule-owned, sch-command, dashboard-applied + ledger-repaired (NOT `db push` — RESUME ALERT). Author files only at plan time.
