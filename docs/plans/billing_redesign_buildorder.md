# Billing Redesign & Deposit — Phase 2 Build Order

**Status:** PLAN — order LOCKED, phase detail DERIVED from code reading
**Repo:** sch-command (cross-repo: sales-command for the deposit)
**Branch:** feat/billing-forecast
**Date:** 2026-06-19
**ERD:** Loop #36 (billing-back log items)
**Companion:** `billing_forecast_integration.md` (the forecast itself, already shipped). This doc orders the *remaining* billing backlog: BF-1…9 + ADJ-1…7.

Confidence tags: **[LOCKED]** confirmed in code · **[DERIVED]** inferred from code, not yet built · **[DESIGN-OPEN]** needs a call · **[BLOCKED]** needs external work.

---

## Goal (from the loop's picture)

Manage margin better than any other software, because the data was structured right from the sale. A deposit on a job auto-surfaces for billing the moment the job is scheduled — three or four clicks to ship the invoice. Field-complete (later) kicks a job to the billing list with costs and over/under visible. Real-time visibility throughout. **Phase 2 = knock down the billing backlog in a durable order, starting with the deposit, so it's usable for the first paying customer ~7 days out.**

---

## Method note — this plan is code-grounded

Order and per-phase scope were verified by **reading the actual code on 2026-06-19**, not the backlog prose. Several prose claims were stale; corrections below. Build off this doc, not the raw backlog notes.

### Prose corrections (verified in code)

- **ADJ-3 is already done.** [LOCKED] `Jobs.jsx:14-20` (TAB_REDIRECTS) and `JobsPicker.jsx:72` (`goBilling`) already route to `/billing?tab=worklist`. → verify + close, no build.
- **The worklist is no longer a "3-column RTB pipeline."** [LOCKED] The forecast build already reshaped it into a status-grouped list under a Worklist/Forecast two-tab shell (`BillingWorklist.jsx:10-17`, `Billing.jsx:81-89`). BF-3 reshapes *this*, not a pipeline.
- **BF-8's gate is a contained change, not a spine rebuild.** [LOCKED] Population logic already lives in `billingForecast.js:268-293`; it just doesn't gate on schedule dates yet.
- **ADJ-4 redundancy is real.** [LOCKED] `expectedPayDate()` includes `terms_override` in the step-3 fallback COALESCE (`billingForecast.js:166-174`) — dead branch.
- **No deposit data exists anywhere.** [LOCKED] `proposals` and `invoices` schemas have no deposit field.
- **Retention is a directly reusable template; invoice "type" is currently implicit.** [LOCKED] Archive invoice = `invoice_lines` with null `proposal_wtc_id`; pay-app = lines with `billing_schedule_line_id`. No explicit type column today.

---

## §0 Reproduction — current state (pre-build, observed 2026-06-19)

This is a feature build, not a bug fix, so "reproduction" = the **observed pre-build state** the Phase-1 deposit work changes. Each item is third-party reproducible; values confirmed in code/migrations on 2026-06-19.

**Schema (sales-command, shared Supabase `pbgvgjjuhnpsumnowuym`):**
- `grep -rniE "deposit" supabase/migrations | grep -iE "proposal|invoice"` → **0 rows.** No `proposals.deposit_required` / `proposals.deposit_amount`; no `invoices` deposit field. A deposit cannot be flagged on a proposal today.
- `grep -rniE "add column.*type" supabase/migrations | grep -i invoice` → **0 rows.** No `invoices.type` column. Invoice "kind" is **implicit, enforced per-line in app code**: archive = `invoice_lines` with null `proposal_wtc_id`; pay-app = `billing_schedule_line_id` non-null (`20260416175646_billing_schedule_and_archive_links.sql:140-149`, "a line must reference exactly one of"). → A deposit line built by reusing the archive path (null `proposal_wtc_id`) is **byte-identical to an archive line** — nothing distinguishes a deposit invoice without an explicit marker.

**UI / behavior (observed):**
- Sales `ProposalDetail` summary (`ProposalDetail.jsx:1096-1246`) has **no deposit control** — no checkbox, no amount.
- Sales `NewInvoiceModal` (`Invoices.jsx:39-562`) has **no deposit-invoice path**; created invoices carry no "materials deposit" label on preview or PDF.
- Schedule billing worklist's "Deposit due" is an **unbacked guess** (no backing data anywhere — SCH_HANDOFF_v21); `buildBillingSurface()` (`billingForecast.js:268-293`) does **not** gate on schedule dates, so a job surfaces before it's scheduled.

**Net pre-build state:** a deposit cannot be (a) flagged on a proposal, (b) billed as a distinguishable/labeled invoice, or (c) truthfully surfaced by Schedule. Phase 1 builds exactly that chain; the POINT-AT (ERD Loop #36) is the proof: test job → scheduled → deposit on billing list → click-through → "materials deposit invoice" ships.

---

## Build order (durable: data model → spine → features → cleanup)

| Phase | What | Why here |
|---|---|---|
| **0** | ADJ-3 (verify+close), ADJ-4 (drop dead branch) | Trivial; clears confusion before building. |
| **1 — Deposit foundation + proof** | Sales deposit data + invoice + label; Schedule schedule-date gate | Durable source-of-truth data model AND it delivers the loop's POINT-AT. No throwaway. |
| **2 — Worklist reshape (spine)** | BF-3 card-picker + BF-8 section split + BF-1 header + BF-2 filter | Biggest design item; deposit rows inherit the new style for free. |
| **3 — Nav + polish** | BF-5 clickable rows→Sales, BF-6 card restyle + forecast rows | Overlays on the spine. |
| **4 — Past-due truth** | ADJ-6 `amount_paid/balance_due` → BF-7 AR aging bands | Aging is only honest once net exists. |
| **5 — Forward calendar** | BF-9 forward/back billing calendar | Builds on BF-2/BF-8. |
| **6 — Cutover cleanup** | ADJ-5, ADJ-2 realtime, ADJ-7 retire `billing_log`, close ADJ-1 | Reversible, post-proof. |

The deposit (Phase 1) comes *before* the card redesign (Phase 2) because the code shows its durable foundation — deposit source-of-truth fields, `invoices.type`, and the schedule-date gate — doesn't depend on the redesign, and it delivers the proof. Spine-first and proof-first coincide.

---

## Phase 0 — corrections

- **ADJ-3** — confirm `/billing?tab=worklist` everywhere, close the item. [LOCKED done]
- **ADJ-4** — remove `terms_override` from the step-3 COALESCE in `expectedPayDate()` (`billingForecast.js:171`); keep it only as step 1. [DERIVED]

---

## Phase 1 — Deposit foundation + proof (the POINT-AT)

Cross-repo. **Most of the build is sales-command.** Schedule just surfaces and links.

**Proof path:** test job → put on schedule (has dates) → deposit shows on billing list → click row → Sales proposal opens (new tab) → "create invoice" → invoice denotes **materials deposit** → flow works. *(Field-complete half is out of scope — Field Command work.)*

### 1a — Schema (sales-command owns `proposals` + `invoices`)
- `proposals.deposit_required boolean default false` [DERIVED]
- `proposals.deposit_amount numeric default 0` [DERIVED]
- `invoices.type text` column, check `'regular' | 'deposit' | 'pay-app'`, **NOT NULL**. [LOCKED 2026-06-19 — `type` column over boolean.]
- **Backfill rule [REVISED round-1, RATIFIED 2026-06-19] — mirror the existing per-invoice classifier, not a line-level shortcut.** The app already classifies an invoice by examining **all** its lines (`Invoices.jsx:1224`): `isArchiveInvoice = lines.length > 0 && lines.every(l => !l.proposal_wtc_id && !l.billing_schedule_line_id)`. The round-1 audit (5H) caught that the prior "null `proposal_wtc_id` = archive" *line-level* rule mislabels mixed/pay-app invoices on live data. Correct backfill: any invoice with **any** line carrying `billing_schedule_line_id` → `'pay-app'`; everything else → `'regular'`. No `'deposit'` exists in history (the new create path is the only writer of `'deposit'`).
- **Pinned DDL order, one transaction (`BEGIN/COMMIT`):**
  1. `ADD COLUMN type text DEFAULT 'regular'` (every existing row → `'regular'`; column non-null via default).
  2. `UPDATE invoices SET type='pay-app' WHERE type='regular' AND id IN (SELECT invoice_id FROM invoice_lines WHERE billing_schedule_line_id IS NOT NULL)` — idempotent (re-run skips already-classified pay-apps; never touches `'deposit'`).
  3. `ADD CONSTRAINT invoices_type_check CHECK (type IN ('regular','deposit','pay-app'))` — added **after** backfill so no existing row violates it.
  4. `ALTER COLUMN type SET NOT NULL` (default already guarantees it; explicit for the contract).
- **Post-backfill verify (run + record before declaring done):** `SELECT type, count(*) FROM invoices GROUP BY type;` and cross-check pay-app count against `SELECT count(DISTINCT invoice_id) FROM invoice_lines WHERE billing_schedule_line_id IS NOT NULL;` — the two pay-app numbers must match.
- **Authoring + deploy [CORRECTED]:** migration lives in **sales-command** (owns `proposals` + `invoices`). **Author and push from the sales-command repo via its `npm run db:push` path + `node scripts/check-migration-collision.mjs`** (and `scripts/check-migration-safety.sh`). Do **NOT** run from sch-command — `db push` is blocked here (cross-repo ledger; see CLAUDE.md). Timestamp must be collision-checked against the prod ledger first.
- **HOLD FOR ROUND-2:** this §1a (backfill only) goes back to T2 for a quick round-2 re-audit **before** it runs against prod — it mutates live invoice rows. §1c/§1d code can build and ride to T4; the §1a *execution* waits.

### 1b — Sales UI: deposit control on ProposalDetail summary
- Add **deposit checkbox + amount** to the `ProposalDetail` summary panel (`ProposalDetail.jsx:1096-1246`). Saves to `proposals`. [DERIVED]
- **Visibility is a hard requirement (Chris):** a distinct bordered callout card with the Command Green accent — not a faint inline checkbox, not tucked among the top menu buttons. When deposit is required, the amount reads boldly at a glance. Must not get lost in the muted linen UI. [LOCKED requirement]

### 1c — Sales invoice flow: create + label the deposit invoice
- In `NewInvoiceModal` (`Invoices.jsx:39-562`): when the selected proposal has `deposit_required` + `deposit_amount > 0`, offer "create deposit invoice." [DERIVED]
- Create it by **reusing the archive-invoice path** (`handleCreate`, `Invoices.jsx:213-300`): one `invoice_lines` row with null `proposal_wtc_id`, `amount = proposal.deposit_amount` shown as a **suggested, editable** figure (BF-4). [DERIVED]
- **`type` must be set explicitly in EVERY `handleCreate` branch [REVISED round-1].** The audit confirmed nothing in `handleCreate` writes `type` today — it is unbuilt, not "reused." Every create path must set it: deposit branch → `'deposit'`; pay-app branch → `'pay-app'`; archive/proposal branch → `'regular'`. A deposit line is byte-identical to an archive line, so the **only** thing distinguishing them is `type` — if the deposit branch forgets to set it, the deposit is indistinguishable from an archive invoice (DEFAULT `'regular'` would silently mislabel it). [LOCKED]
- **Deposit label = NEW badge, gated on `type==='deposit'` [REVISED round-1].** No "MATERIALS DEPOSIT INVOICE" badge exists today — it is new code, not an existing pattern to mirror. Add the badge to the preview (`Invoices.jsx:565-939`) **and** `invoicePdf.js`, each rendered only when `invoice.type==='deposit'`, near the invoice # / status. [LOCKED]
- **Deposit amount validation [REVISED round-1]:** reject `deposit_amount <= 0`; warn (not block) when `deposit_amount > proposal.total`. The figure is suggested-editable, so validate at create time.
- **Full-amount → Fully Billed decision [REVISED round-1]:** if an editable deposit equals the full authoritative total, the job is **Fully Billed**, not Partially. The worklist already resolves this via `billed >= authoritative` (`billingForecast.js:278`) — no special-casing needed in Schedule; just ensure the deposit invoice's `amount` flows into `billedTotal`. [DERIVED]
- Once sent, the deposit keeps its unique invoice ID; the job's worklist label follows from `billedTotal` (see §1d — driven by `billed`, not `type`). [DERIVED]

### 1d — Schedule: surface the deposit, gated on scheduled
- **Gate on raw `job.status !== 'Parked'` [REVISED round-1].** The original date-proxy gate (exclude jobs with no `scheduled_end`/`end_date`/`partial_bill_date`) is wrong: the audit showed it **defeats itself** — many scheduled jobs have null date fields, so a date proxy would hide jobs that ARE scheduled. The correct signal is the lifecycle status: a job leaves `'Parked'` the moment Schedule confirms it (the Send-to-Schedule → Confirm flow). Gate `buildBillingSurface()` (`billingForecast.js:247`) on the **raw** `job.status` string `!== 'Parked'` — NOT `getJobStatus()` (a derived/billing status, wrong axis), NOT a date proxy. [LOCKED]
- **Add the missing SELECT columns [REVISED round-1] — they are not loaded today:**
  - `INVOICE_SEL` (`queries.js:606`) must add `type` (currently absent — the worklist can't read it without this).
  - the proposals select (`queries.js:618`, currently `'id, call_log_id, status, total, is_archive_proposal'`) must add `deposit_required, deposit_amount`.
  - **Both depend on §1a's migration being live** (the columns don't exist until then) — so this part lands after §1a clears round-2 + prod.
- **DELETE the "reads `invoices.type='deposit'` to flip Partially Billed" claim [REVISED round-1].** It's false. The worklist label/status already flips off `billedTotal` — `billed < authoritative` → "Partially billed", `billed >= authoritative` → "Fully billed" (`billingForecast.js:278,348-351`). Schedule does **not** read `type` to drive status; the deposit invoice's `amount` flowing into `billedTotal` is what moves the job. `type` is read only for the *deposit label/UX*, not the status transition.
- Worklist shows the deposit as a **suggested amount** for non-Parked jobs with `deposit_required`. [DERIVED]
- Row click → Sales proposal in a new tab (this is BF-5, pulled forward minimally for the proof). [DERIVED]

### Phase 1 decisions / risks
- **`invoices.type` column vs one-off boolean** — [LOCKED 2026-06-19] `type` column: it unifies the currently-implicit archive/pay-app detection and makes future types easy. One-time backfill from line FKs.
- **How Schedule knows the job is "scheduled"** — [REVISED round-1] use the raw lifecycle status `job.status !== 'Parked'`, NOT the date fields (date proxy defeats itself — scheduled jobs often have null dates). See §1d. [LOCKED]
- **Deposit invoice ↔ job linkage** — invoice already carries `call_log_id` (`Invoices.jsx:256-257`). Confirm copy-vs-reference: Schedule **references** (reads), never copies. [DESIGN-OPEN]
- **Can Sales create a deposit invoice before the job is scheduled?** — [LOCKED 2026-06-19] **Gate only the Schedule worklist surfacing; Sales create-invoice stays independent.** Deposits get collected at signing (before scheduling), so Sales must be able to invoice anytime; Schedule's BF-8 date gate handles "don't surface/nag until scheduled." Avoids coupling Sales' invoice action to Schedule's scheduling state.

---

## Phase 2 — Worklist reshape (the spine)

- **BF-3** — card-picker like `JobsPicker` (`JobsPicker.jsx:77-244` is the reference): one card per lifecycle category w/ count + an "All" card. Categories: **Not Started / In Production / Production Complete / Partially Billed / Fully Billed / All.** Add a manual "Job not started" flag (distinct from Hold). Clean read-only rows; move manual controls (Hold / nothing-to-bill / terms-override / notes) into a drill-in. [DERIVED]
  - **Mapping is the real design work** [DESIGN-OPEN]: current billing statuses are invoice-state-based (NEEDS_TRIAGE/SENT/…, `billingForecast.js:87-95`); the card categories are lifecycle-based (live in `jobs.status`: Scheduled/In Progress/Complete/…). Needs an explicit cross-map. "Production Complete" builds off the existing `Complete` status now; the Field Command auto-trigger is later.
- **BF-8** — finish the action-pile vs done-pile section split (gate shipped in Phase 1). Action pile = all still-owed, NOT date-scoped. Done pile = Partially/Fully Billed, scoped to the active window by invoice `sent_at`. [DERIVED]
- **BF-1** — header + Back button (→ `/jobs` JobsPicker). Currently no header (`Billing.jsx:81-89`). [DERIVED]
- **BF-2** — time-period filter in the header (day/week/month/quarter/year + custom), mirroring `Jobs.jsx:129-133`. The header date IS the active window and scopes the done pile. [DERIVED]

---

## Phase 3 — Nav + visual polish

- **BF-5** — worklist row click → `salescommand.app/calllog/<call_log_id>` in a new tab (every row carries `call_log_id`). [DERIVED]
- **BF-6** — card/bubble restyle + clickable forecast rows (design ref: Sales Command Proposals + Invoices lists). Forecast per-week drill-down is a plain table today. [DERIVED]

---

## Phase 4 — Past-due truth

- **ADJ-6** — add `invoices.amount_paid` / `balance_due` (today `paid_at` is binary), subtract in the past-due bucket. Matters for **partial PAYMENT** of non-GC invoices (partial *billing* is already tracked). [DERIVED]
- **BF-7** — Past Due: AR aging bands (1–30 yellow / 31–60 orange / 61–90 red / 90+ dark red) w/ $ subtotals, "X days overdue", oldest-first. "Current" stays on the upcoming side. Reword the gross-of-partials caveat to plain English about partial *payment*. [DERIVED]

---

## Phase 5 — Forward calendar

- **BF-9** — step the header window forward/back to see upcoming billing actions. Predict from `jobs.scheduled_end`/`end_date` + `jobs.partial_bill_date`. **Distinct from Forecast:** Forecast = cash IN; this = invoices OUT. Only dated jobs get placed on a future week. [DERIVED]

---

## Phase 6 — Cutover cleanup (post-proof)

- **ADJ-5** — label JobDetail billing history as legacy (`JobDetail.jsx:76`) or repoint at the invoice source. [DERIVED]
- **ADJ-2** — add a Supabase realtime subscription on `invoices` (or a refresh affordance); load is one-shot today (`Billing.jsx:41-49`). [DERIVED]
- **ADJ-7** — retire the remaining read-only `billing_log` reader once the new surface is proven. [DERIVED]
- **ADJ-1** — close out; retention confirmed forecast-safe, only a stale legacy `retainage_amount` on invoice 10024 remains (data-quality note, nothing in scope reads it). [LOCKED]

---

## Cross-app data contract additions

Per `command_suite_shared_data_contract.md`, every cross-app field needs source-of-truth, canonical location, copy-vs-ref, sync pipe.

| Field | Source of truth (writer) | Canonical location | Copy vs ref | Sync pipe |
|---|---|---|---|---|
| `proposals.deposit_required` / `deposit_amount` | Sales Command (proposal) | `proposals` table | Schedule **references** (reads) | PostgREST (both web apps) |
| `invoices.type` | Sales Command (invoice creation) | `invoices` table | Schedule references | PostgREST |

---

## Open decisions (carry into build)

1. ~~`invoices.type` column vs boolean~~ — **[RATIFIED 2026-06-19] `type` column** (`'regular' | 'deposit' | 'pay-app'`), one-time backfill from line FKs.
2. `jobs.status` → billing lifecycle card mapping (Phase 2) — design when we reach it. **[OPEN — does not block Phase 1]**
3. ~~Gate Sales-side deposit-invoice creation, or only Schedule's surfacing~~ — **[RATIFIED 2026-06-19] gate only Schedule's worklist surfacing**; Sales create-invoice stays independent.
4. Deposit invoice → job linkage confirm (copy-vs-reference; reads only). **[OPEN — low risk; Schedule reads `call_log_id`, never writes]**

Phase 1's two blocking design-opens (#1, #3) are now ratified. #2 and #4 do not block Phase 1 (#2 is Phase 2; #4 is a read-only confirm).

## Scope guard

**OUT of scope this phase:** Field Command "Job Complete" auto-trigger that kicks a finished job onto the billing list. That's Field Command work; the lifecycle "Production Complete" category builds off the existing `Complete` status for now.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-19. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a small but **money-touching, cross-app** change — the deposit foundation (Phase 1). Three reviewers, each on one risky spot: (1) the database migration + the one-time relabel of existing invoices, (2) the deposit-to-invoice flow itself, and (3) how Schedule reads the new data without writing it. The later restyle phases aren't audited this round — they sit on a forecast that already passed three audit rounds. Quick, focused check.

### Round
- Current round: 1
- Plan revision under audit: `d40cf81` (+ this manifest commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1 for `billing_redesign_buildorder.md`.

(Note: the companion `billing_forecast_integration.md` — already shipped — went through rounds 1–3 separately; the restyle phases here sit on that audited surface and are **out of scope** this round.)

**Briefing for agents**: attack ONLY **Phase 1 (deposit foundation)** + **Phase 0 (ADJ-4 dead-branch removal)**. Phases 2–6 are restyle/reshape of the already-3×-audited forecast surface — do not re-find issues there. The §0 Current-state section is the observed pre-build baseline; do not re-derive it.

### Deployment context
- **Live tenants**: 1 — HDSP only (multi-tenant onboarding blocked). Cross-tenant findings cap at **Med**.
- **Prod / staging / dev**: affected surface is **live in prod** — sales-command billing (HDSP) and sch-command billing worklist (v7+v8, prod 2026-05-06). Migration + backfill touch live data.
- **Blocking feature flags**: `customers.requires_pay_app` routes pay-app vs regular invoicing; the deposit is a new third invoice path that must not break that routing.
- **Concurrency profile**: solo / ≤5 (office staff: Joe, John, Denise). Multi-user race findings cap at **Low**.

### Time budget + finding cap
- **Time budget**: **60 min [RATIFIED 2026-06-19]** — Loop #36 is outcome-defined (~7 days), no clock lock; 60 min set as the Phase-1 audit-pass budget.
- **Finding cap**: **6** findings (`max(3, ceil(60/10))`). Surface top-6 most consequential; remainder → "Quarantined (not actionable this loop)."

### Surface
- Total lines: 171
- Sections: 14
- [LOCKED] decisions: 13 (incl. 2 ratified 2026-06-19: `invoices.type` column, gate-Schedule-only)
- [DESIGN-OPEN] items: 3 (2 are Phase 2; 1 is Phase-1 deposit↔job linkage, low-risk read-only)
- [OPEN] items: 2 (both non-blocking for Phase 1)
- Plan-to-code ratio: ~171 : ~400 est (≈0.4:1) — plan smaller than the fix; not scope-crept.

### Layers touched (Phase 1)
- UI / components (ProposalDetail deposit card, NewInvoiceModal, invoice preview + PDF)
- State model (new columns: `proposals.deposit_required/deposit_amount`, `invoices.type`)
- Migrations / schema (additive columns + a **data backfill** of `invoices.type`)
- Data layer (schedule-date gate in `billingForecast.js`, worklist read in `queries.js`)
- Cross-repo (sales-command owns `proposals`/`invoices`; sch-command reads via PostgREST)

### New mechanisms introduced
- New columns: `proposals.deposit_required` (bool), `proposals.deposit_amount` (numeric), `invoices.type` (text + CHECK `'regular'|'deposit'|'pay-app'`)
- New data backfill: `invoices.type` for all existing rows, derived from line FKs
- New invoice path: deposit invoice via the reused archive path + "MATERIALS DEPOSIT INVOICE" label (preview + PDF)
- New gate: schedule-date population gate in `buildBillingSurface()`

### Cross-system reach
- **sales-command** — owns `proposals` + `invoices`; the migration + backfill + UI live there.
- **sch-command** — reads `invoices.type='deposit'` + deposit fields via PostgREST to surface + drive Partially Billed.
- Shared Supabase `pbgvgjjuhnpsumnowuym`; cross-repo migration timestamp/ledger coordination required (see CLAUDE.md + O7).

### Irreversibility
- Additive columns (reversible) **but** the `invoices.type` backfill **mutates live rows** — misclassification would mislabel real invoices. Backfill correctness is the irreversible risk.
- Cross-repo migration timestamp must be collision-checked against the prod ledger before push (`check-migration-collision.mjs`); `db push` is blocked from sch-command — migration runs from sales-command per its rules.

### Known weak points
- **Backfill misclassification** (§1a): a deposit line reuses the archive shape (null `proposal_wtc_id`) — so a deposit line is byte-identical to an archive line. The backfill must classify *existing* rows by FK, and the new deposit path must set `type='deposit'` explicitly, or deposits get mislabeled as 'regular'/archive.
- **CHECK-constraint ordering** (§1a): existing rows must be backfilled to a valid `type` *before* the CHECK is added, or the migration aborts.
- **Schedule-date gate over/under-exclusion** (§1d): jobs with a deposit but null/odd `scheduled_end`/`end_date`/`partial_bill_date` could be wrongly hidden (deposit never surfaces) or wrongly shown (surfaces before scheduled).
- **Partially-Billed transition depends on `invoices.type`** (§1c/1d): if Sales doesn't write `type='deposit'` on the user's actual path, Schedule never flips the job → silent failure of the POINT-AT.
- **Cross-repo read / RLS** (§1d): Schedule reads new columns via PostgREST — confirm row-level RLS grants the read and that Schedule only *references* (never writes) these sales-owned fields.
- **PostgREST 1000-row cap** on the billing-surface read (`queries.js:605-646`) — confirm pagination if the deposit gate widens the result set.

### Open questions
- Count: 1 Phase-1-relevant (deposit↔job linkage copy-vs-ref confirm — low risk, read-only). The two blocking design-opens (`invoices.type` shape, Sales-vs-Schedule gating) were **ratified 2026-06-19**.
- Highest-pressure: does any code on the obvious user path actually SET `invoices.type='deposit'`? (Angle 2 must confirm the setter exists, not just the reader.)

### Suggested attack angles (3 total)
1. **Schema + migration + backfill correctness (cross-repo)** — covers migrations/schema, state model (new columns), cross-repo. Required reading: `sales-command/supabase/migrations/20260416175646_billing_schedule_and_archive_links.sql`, sales-command migration rules (`scripts/check-migration-safety.sh`, `check-migration-collision.mjs`), sch-command `CLAUDE.md` (ledger/O7). Specific pressure: `invoices.type` backfill misclassification (archive-vs-deposit ambiguity), CHECK-constraint ordering vs backfill, live-data mutation reversibility, cross-repo timestamp/ledger collision.
2. **Deposit lifecycle — user-path state trace** (mandatory: §1 root cause names `invoices.type`, a variable a status gate reads). Covers UI flow + state-model transitions. Required reading: `ProposalDetail.jsx:1096-1246`, `Invoices.jsx:39-562,213-300,565-939`, `invoicePdf.js`, `billingForecast.js:87-95`. Specific pressure: trace flag→suggested-editable-amount→deposit invoice→Partially-Billed; **name the code path that SETS `type='deposit'`** (if no setter on the obvious path, the status flip is dead); amount edge cases (0, > proposal total, edited down).
3. **Schedule surfacing gate + cross-repo read** — covers data layer, the schedule-date gate, RLS-light. Required reading: `billingForecast.js:268-293`, `queries.js:605-646`, `command_suite_shared_data_contract.md`. Specific pressure: gate over/under-exclusion on null/odd date fields, RLS read access to new columns, copy-vs-ref discipline (Schedule reads, never writes), PostgREST 1000-row pagination on the widened surface.

### Suggested agent count: 3

Rationale: 5 layers collapse cleanly into 3 non-overlapping angles (schema/migration, deposit lifecycle, Schedule read-gate); deployment context (1 tenant, ≤5 users) caps most cross-tenant/race severity, so a 4th RLS-only agent would mostly produce capped-Low noise. Sits at the 3–4 boundary — bump to 4 only if you want the migration-backfill split out from cross-repo for extra rigor on the one irreversible, money-touching piece.
