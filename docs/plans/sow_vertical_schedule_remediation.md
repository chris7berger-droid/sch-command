# Remediation Plan — SOW Vertical, Schedule-side rebuild on the current card design

**Status:** DRAFT for audit · supersedes the SCH placement decisions in `sow_vertical.md`
**Created:** 2026-06-15 (after Sales→Schedule smoke FAILED on design-baseline mismatch)
**Repo:** sch-command · branch `feat/sow-vertical`

---

## 1. What happened
SCH1/SCH2/SCH4 were built against the **JobDetail → Planning → Field SOW tab**, a design that
production had already retired in favor of the **Option-D `StageJobCard` + in-card modals**
(`feat/staged-ready-cards`, merged to `main` and present on this branch). Result: the per-WTC /
`job_wtcs` editor and the "Dates TBD" badge sit on surfaces users no longer reach; the surface
they *do* reach (`StageJobCard` SOW chip → `FieldSowModal`) still reads/writes the merged
`jobs.field_sow`, bypassing `job_wtcs`. Because Field reads `job_wtcs` first, Schedule SOW edits
made through the real path never reach the canonical data or the crew. **Smoke failed.**

## 2. Root cause
The vertical plan was authored against the old JobDetail-tab design and never reconciled with the
shipped card redesign. The audits / buildvsplan were spec-vs-code, so a design-baseline mismatch
the plan never named was invisible to every gate.

## 3. Design baseline (LOCKED for this remediation)
**`docs/plans/staged_ready_card_design.md` is the authority.** Confirmations:
- §3.5 — the SOW scorecard's click target is "Field SOW modal (`FieldSowBuilder.jsx`)": the design
  *intended* the in-card SOW modal to use `FieldSowBuilder`; the implementation diverged to
  `FieldSowModal`. Aligning to per-WTC completes the design's stated intent.
- §376 — JobDetail `?mode=management` "now serves only as a deep-history/audit-log surface": the
  Planning tabs (where SCH1 placed the editor) are **deprecated**.
- `Jobs.jsx:188` calls `loadJobs({ withWTCs: true })` and `StageJobCard` already uses `job._wtcs`,
  so the card has per-WTC data today — badge + per-WTC editing need no new loaders.

Planning happens in **in-card modals** on `StageJobCard`. **No work may reintroduce JobDetail
Planning tabs.**

**DaysModal write authority — [LOCKED Option 3] (Chris, 2026-06-15):** "single canonical writer" means
one write **function** (`updateJobWtcFieldSow`), **not** one UI. So the DAYS modal is a **read-only
overview that is click-to-edit**: each day row **deep-links into the in-card SOW modal** (the per-WTC
`FieldSowBuilder`) focused on that day's WTC. The DAYS modal itself performs **no SOW/date write** — it
only navigates to the canonical editor, where the write goes through `updateJobWtcFieldSow`. This
preserves the single-write-**function** discipline AND delivers finding #4 ("click a day to fix it").
(Supersedes the earlier Option-1 read-only-only framing.)

**Readiness-display authority — [LOCKED Option 1 + popup] (Chris, 2026-06-15):** The **JS predicate
(`hasFieldSow` / `baseChecklistPasses` / `isReady`) is authoritative for the readiness *display*** — it
re-evaluates on every `loadData` (`Jobs.jsx:221`), so the tile/banner always reflect current SOW state.
**No new `job_wtcs` recheck trigger is added.** The DB fn's auto-demote (`assignments_recheck_parents`,
`20260528133000:67`) stays the backstop — but it only fires on `assignments`/`materials` writes, NOT on
SOW writes. So this is **NOT** a claim of DB-enforced readiness on SOW change; "JS↔SQL parity" (§4.1)
means the two predicates encode the *same logic* for a consistent read, not that the DB *enforces* the
gate on every SOW edit.

Because the DB does not auto-demote on a SOW-empty, the one stale-flag gap (a job left `ready_confirmed_at
!= null` after its SOW is removed) is closed **in the handler, without a trigger** (Chris's refinement,
§6.1 step 1 Finding F): the card SOW-modal save that empties a Ready job's last SOW ALSO clears
`ready_confirmed_at` in the same flow and fires a **"All SOW removed — this job has moved back to
Staged."** toast. Targeted handler-side clear, NOT a DB trigger.

## 4. Complete SOW / per-day-dates surface inventory

**[DERIVED — recurrence vector]** Round-1 audit found the §4 inventory MISSED the **Staged→Ready readiness gate**, which is itself a SOW-*reading* surface and still keys on `jobs.field_sow` only. This is the exact failure class that shipped: a SOW-touching surface absent from the inventory. The readiness predicate exists in **two reconciled copies** (JS + SQL) that must be unified on ONE WTC-aware predicate (Finding A below).

### 4.1 The shared WTC-aware SOW predicate [LOCKED]

Every "does this job have a Field SOW?" check — read or gate — resolves through ONE predicate:

```js
// canonical SOW-present test (JS form) — extracted to hasFieldSow(job) in queries.js (Fold O3)
const hasFieldSow =
     (job._wtcs?.some(w => Array.isArray(w.field_sow) && w.field_sow.length))
  || job.field_sow != null
```

**[Finding A — empty-array JS↔SQL parity, the asymmetry is INTENTIONAL].** `job_wtcs.field_sow`
is **NOT NULL** and defaults to `'[]'` (confirmed: `20260512120100_job_wtcs_create.sql` — a freshly
materialized WTC carries `field_sow = '[]'`, never null). So the WTC branch must test **emptiness**,
not nullness: JS `w.field_sow.length` treats `[]` as "no SOW," and the SQL mirror MUST match by
testing `jsonb_array_length(...) > 0`. A naive SQL `field_sow IS NOT NULL` on the WTC branch would
pass an empty `'[]'` WTC → **DB says ready, tile says missing** — the exact JS↔SQL drift this fix
exists to prevent.

The SQL mirror (`job_base_checklist_passes`) is redefined so the SOW-present test is **VERBATIM**:

```sql
EXISTS(SELECT 1 FROM job_wtcs w WHERE w.job_id = p_job.job_id AND jsonb_array_length(w.field_sow) > 0) OR p_job.field_sow IS NOT NULL
```

**Named asymmetry (intentional, do NOT "normalize" the two branches):**
- **WTC branch** → `jsonb_array_length(w.field_sow) > 0`. WTC `field_sow` is `NOT NULL DEFAULT '[]'`,
  so `[]` is the "empty" sentinel — nullness is impossible; emptiness is the real signal. Mirrors JS
  `w.field_sow.length`.
- **Parent branch** → `p_job.field_sow IS NOT NULL`. The legacy `jobs.field_sow` column **is**
  nullable (legacy merged jobs with no `job_wtcs` children), so `IS NOT NULL` is the correct legacy
  fallback. Mirrors JS `job.field_sow != null`.

The two branches deliberately use **different operators** because the two columns have **different
null semantics** (WTC: never-null, empty=`[]`; parent: nullable). Replace the current
`IF p_job.field_sow IS NULL THEN RETURN false;` with this WTC-OR-parent EXISTS check (see §6.1 step 0
for the full migration body, built on the `...133000` base).

### 4.2 Surface table

| Surface | Today (verified file:line) | Disposition |
|---|---|---|
| **Staged→Ready readiness gate (JS)** — `queries.js:38-45` `baseChecklistPasses` (`hasSOW = job.field_sow != null`, line 39) + `queries.js:49-53` `isReady` | reads `jobs.field_sow` only — **MISSED in round-1 inventory** | **REWIRE** `baseChecklistPasses` `hasSOW` to §4.1 predicate. **COUPLED** with the SQL fn (next row) — same step. |
| **Staged→Ready readiness gate (SQL)** — `job_base_checklist_passes(p_job)` — **canonical def in `20260528133000_repoint_crew_readiness_to_assignments.sql:32`** (redefines the earlier `20260528120000_...:60`; crew signal now reads `assignments`) | `IF p_job.field_sow IS NULL THEN RETURN false;` | **REWIRE** to §4.1's WTC-OR-parent EXISTS check. **COUPLED with the JS edit — must land in the SAME step**: a new migration redefines the fn; the JS predicate changes alongside it. Migration goes through the dashboard-apply + `migration repair --status applied` discipline (see §3 deploy path in `CLAUDE.md`); base the redefine on the **`...133000` body** (latest), not `...120000`, or the assignments-based crew check is lost. |
| `JobsPicker.jsx:34` tile-checklist SOW counter (`if (j.field_sow == null) missingSow++`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate (negated). |
| `StageJobCard.jsx:111` staged banner missing-📋 (`if (job.field_sow == null) missing.push('📋')`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate (negated). |
| `StageJobCard.jsx:206` PlanningPanel SOW scorecard (`const hasSOW = job.field_sow != null`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate. |
| `StageJobCard` **SOW** chip → in-card modal | opens `FieldSowModal` → merged `jobs.field_sow` | **REWIRE** → in-card modal hosting per-WTC `FieldSowBuilder` writing `job_wtcs` (design §3.5). Primary editor. See §6.1. |
| `StageJobCard` **DAYS** chip → `DaysModal` (`DaysModal.jsx`) | **already read-only**; reads job-level `scheduled_start`/`start_date` | **UPDATE** to read canonical per-WTC `job_wtcs` dates + TBD state; **read-only overview + click-to-edit deep-link into the SOW modal; no independent write path** ([LOCKED Option 3]; §6.1 step 4 — `initialWtcId`/`initialDayIndex` focus + per-WTC day tagging). |
| `StageJobCard` card body / **WORK TYPES** | uses `job._wtcs` | **ADD** "Dates TBD" indicator (SCH4) |
| `FieldSowModal` (`FieldSowModal.jsx`) | merged editor (`handleSave:83` writes `jobs.field_sow:92`), not WTC-aware | **STRIP EDIT PATH** → Print-only, reading `_wtcs`. See §6.1 step 5 (+ Fold O1: per-WTC Print sections + Print entry button in the new modal). After this it has NO write to `jobs.field_sow`. |
| **JobDetail `?mode=planning` Field SOW tab** (SCH1's edit) — render `JobDetail.jsx:448-494`; planning-tab-group gate `:193`; default-tab `:86`; URL deep-link consumed `:53` | per-WTC editor but on a **deprecated** surface | **REVERT** — JobDetail is mgmt-only. See §6.1 step 3 for exact targets. |
| ~~SCH4 badge on `ScheduledCardList`~~ | **`ScheduledCardList` is DEAD — zero importers** (verified: no `import`/`<ScheduledCardList` anywhere in `src/`) | **DELETE** the dead file; do NOT treat `ScheduledCardList:148/159` as live `mode=planning` deep-links. |
| Live `mode=planning` deep-links | `JobCardList.jsx:258` ("Job Planning" button) | **REMOVE** — only reachable `mode=planning` entry that survives. |
| Schedule crew-view **SCOPE/SOW** field (#9) | `jobs.sow` text, not openable | make readable from canonical |
| `queries.js updateJobWtcFieldSow` (`queries.js:500`, sig `(jobWtcId, nextFieldSow, changedBy, source)`) | writes `job_wtcs` ✓ + audits | **KEEP** — reuse from the card modal |

## 5. Salvaged vs redone
- **KEEP (correct):** `updateJobWtcFieldSow`; the `FieldSowBuilder` enhancements (date picker, `date`
  coercion guard, `handleSave` date preservation, scope-frozen note); both migrations (applied);
  **all Sales S1–S4** (different app, smoke-verified); Field F1–F3 (deferred, backlog D1).
- **REDO:** SCH1 editor placement (→ card modal); SCH4 badge placement (→ `StageJobCard`); the
  two-editor consolidation (#6/#8/#10/#11 fold in here).
- **REVERT:** JobDetail Planning Field SOW tab render (`JobDetail.jsx:448-494`) + the live `mode=planning`
  deep-link (`JobCardList.jsx:258`). **DELETE** the dead `ScheduledCardList.jsx` (zero importers) rather
  than reverting its links.
- **UNIFY:** the Staged→Ready readiness predicate (JS `baseChecklistPasses`/`isReady` + SQL
  `job_base_checklist_passes`) onto ONE WTC-aware SOW test (Finding A / §4.1) — the recurrence vector.

## 6. Build sequence

### 6.1 Detailed surface wiring

**Step 0 — shared SOW predicate + readiness reconciliation (Finding A, COUPLED) + extract `hasFieldSow` (Fold O3, MUST).**
Land in ONE step:
- JS — **MUST extract** (Fold O3, upgraded from "consider"): create ONE exported helper
  `hasFieldSow(job)` in `queries.js` encoding the §4.1 predicate verbatim. All **four** JS readers
  import it — no inline copies:
  - `baseChecklistPasses` (`queries.js:38-45`): replace `const hasSOW = job.field_sow != null`
    (`queries.js:39`, verified) with `const hasSOW = hasFieldSow(job)`.
  - `JobsPicker.jsx:34` (`if (j.field_sow == null) missingSow++`, verified) → `if (!hasFieldSow(j)) missingSow++`.
  - `StageJobCard.jsx:111` (`if (job.field_sow == null) missing.push('📋')`, verified) → `if (!hasFieldSow(job)) …`.
  - `StageJobCard.jsx:206` (`const hasSOW = job.field_sow != null`, verified) → `const hasSOW = hasFieldSow(job)`.
  The §7 grep gate (O3) asserts **zero** inline `field_sow == null` / `field_sow != null` SOW-checks
  survive outside `hasFieldSow`.
- SQL — new migration redefining `job_base_checklist_passes` with **`CREATE OR REPLACE FUNCTION`**
  (NOT `DROP` — `assignments_recheck_parents` and the assignment recheck triggers depend on this fn;
  a DROP would cascade them). **Base the body on `20260528133000`** (verified: that migration's def at
  `:20-57` is the latest — it redefines the earlier `...120000` def and repoints the crew signal to
  `assignments`). Swap **only** the SOW test (`...133000:32`, `IF p_job.field_sow IS NULL THEN RETURN
  false; END IF;`) for the §4.1 verbatim WTC-OR-parent EXISTS; keep everything else byte-for-byte —
  **especially the assignments-based crew EXISTS block, inline-quoted here so the builder cannot grab
  the `...120000` job_crew body** (Fold O4):

  ```sql
  CREATE OR REPLACE FUNCTION public.job_base_checklist_passes(p_job public.jobs)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant_id     uuid;
    v_has_crew      boolean;
    v_has_materials boolean;
  BEGIN
    -- [Finding A] SOW-present test: WTC (empty=[]) OR legacy parent (nullable).
    IF NOT (
      EXISTS (SELECT 1 FROM public.job_wtcs w
               WHERE w.job_id = p_job.job_id
                 AND jsonb_array_length(w.field_sow) > 0)
      OR p_job.field_sow IS NOT NULL
    ) THEN RETURN false; END IF;

    IF COALESCE(p_job.scheduled_start, p_job.start_date) IS NULL THEN RETURN false; END IF;

    SELECT cl.tenant_id INTO v_tenant_id
      FROM public.call_log cl
     WHERE cl.id = p_job.call_log_id;
    IF v_tenant_id IS NULL THEN RETURN false; END IF;  -- orphan job → never Ready

    -- crew assigned = at least one assignment for this job (office signal)
    -- [Fold O4] THIS is the ...133000 assignments block — NOT the ...120000 job_crew one.
    SELECT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.job_id = p_job.job_id
    ) INTO v_has_crew;
    IF NOT v_has_crew THEN RETURN false; END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM public.materials m
       JOIN public.jobs j ON j.job_id = m.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE m.job_id = p_job.job_id
        AND cl.tenant_id = v_tenant_id
        AND m.status IN ('Not Ordered', 'Delayed')
    ) INTO v_has_materials;
    RETURN v_has_materials;
  END;
  $$;
  ```
  Do NOT re-create or DROP the `assignments_recheck_*` triggers or `assignments_recheck_parents` —
  they already exist from `...133000` and continue to call this fn unchanged.
- **Timestamp:** `20260616120000` — verified clear of the prod ledger. **Live ledger max is
  `20260613120000`** (queried 2026-06-15: prod holds `20260613120000` = `proposal_wtc.dates_tbd`,
  which is ledger-present but has **no local file** — local file max is `20260612120000`).
  `20260616120000` is after both. Run `node scripts/check-migration-collision.mjs` to re-confirm
  before applying.
- Deploy via dashboard-apply + `supabase migration repair --status applied 20260616120000`
  (`CLAUDE.md` §"Pushing Migrations"); `db push` does NOT work from this repo.
- The JS edit and the SQL migration are a single coupled change — neither ships without the other, or
  the tile/gate and the DB disagree (and on the empty-`[]` WTC case specifically — see §4.1 / §7.3).

**Step 1 — host per-WTC `FieldSowBuilder` in the in-card SOW modal (Findings B, C, E, F). (#6/#8/#10)**

The card path users actually reach is **`Jobs.jsx` → `StagedCardList` → `StageJobCard`** (verified:
`Jobs.jsx:7` imports `StagedCardList`; `StagedCardList.jsx:44` renders `StageJobCard`; the SOW chip
opens the in-card modal at `StageJobCard.jsx:523-533`, currently `FieldSowModal`). The new per-WTC
SOW modal is hosted by **`StageJobCard`**; the materials it needs are loaded in **`Jobs.jsx`** and
threaded down through **`StagedCardList`** (O2 — every step below names its component).

- **Per-WTC builders.** The in-card SOW modal maps `job._wtcs` → renders **one `FieldSowBuilder` per
  WTC**. `FieldSowBuilder`'s verified signature is `({ value, onSave, saving, availableMaterials })`
  (`FieldSowBuilder.jsx:26`); `onSave(clean)` is the save callback (`:142`).
- Each builder saves via `updateJobWtcFieldSow(wtc.id, next, changedBy)` — **real signature
  `(jobWtcId, nextFieldSow, changedBy, source?)`** (`queries.js:500`), passing `wtc.id`, NOT a curried
  call. On success, update local `job._wtcs[i].field_sow` in place (mirror JobDetail at
  `JobDetail.jsx:464-467`).

- **[Finding B — `key={activeWtc.id}` on the per-tab builder, MANDATORY].** `FieldSowBuilder`'s `days`
  state is `useState(() => Array.isArray(value) ? value : [])` (`FieldSowBuilder.jsx:27`, verified)
  with **no re-sync effect** — once mounted, it ignores later `value` changes. In the WTC-**tabs**
  container (below) a single builder instance is reused across tab switches → React keeps the same
  fiber → `days` stays frozen on the prior WTC → a save would write **WTC-A's days under WTC-B's id**.
  Mandate `<FieldSowBuilder key={activeWtc.id} … />` so switching tabs force-remounts a fresh builder
  seeded from that WTC's `field_sow`. (JobDetail dodges this because it renders ALL builders at once,
  each keyed by `wtc.id` on its `.map` wrapper, `JobDetail.jsx:452-453`; the tabs container shows one
  at a time, so the `key` MUST sit on the builder itself.) Acceptable alternative: render-all-mounted
  (drop tabs, vertical stack each keyed) — but [LOCKED] choice is tabs, so the `key` is required.

- **[Finding C — batched `proposal_wtc` materials load, threaded to the card modal].** The card path
  loads **zero** proposal materials today (`Jobs.jsx loadData:184-219` has no `proposal_wtc` fetch),
  so `availableMaterials` defaults `[]` (`FieldSowBuilder.jsx:26`) → the picker is **custom-only**
  (`FieldSowBuilder.jsx:328`, `'+ Add custom material'` when `safeMaterials.length === 0`). Fix:
  - In **`Jobs.jsx` `loadData`** add ONE **batched** query keyed on the staged jobs' `call_log_id`s
    (NOT N per-card queries): `supabase.from('proposal_wtc').select('id, materials,
    proposals!inner(call_log_id)').in('proposals.call_log_id', stagedCallLogIds)`. Flatten/tag each
    material with `_wtc_id = proposal_wtc.id` — **reuse the JobDetail loader shape verbatim**
    (`JobDetail.jsx:100-113`), but `.in(...)` over the set instead of `.eq(...)` per job.
  - Thread the result **`Jobs.jsx` → `StagedCardList` → `StageJobCard` → the SOW modal** as a prop
    (e.g. `proposalMaterialsByCallLog` or a flat array the card filters). `StagedCardList`
    (`:44` signature) passes it straight through to `StageJobCard`.
  - Per-WTC filter inside the modal exactly as JobDetail does (`JobDetail.jsx:460`):
    `availableMaterials = proposalMaterials.filter(m => String(m._wtc_id) === String(wtc.proposal_wtc_id))`.
    `proposal_wtc_id` is confirmed present on `_wtcs` (loadJobs `withWTCs` selects `job_wtcs(*)`,
    `queries.js:115`). Consider lifting the loader+filter into a shared `queries.js` helper so the card
    and JobDetail don't drift. Do NOT invent a new query.

- **Multi-WTC container — [LOCKED] WTC tabs/switcher in the modal:** a job with N WTCs shows N tabs
  (one per `job._wtcs` row, labelled `work_type_name`); the **active** tab renders that WTC's
  `FieldSowBuilder` (with `key={activeWtc.id}`, Finding B) and its `proposal_wtc_id`-filtered
  materials. Single-WTC jobs render one tab / no tab chrome.

- **[Finding E — zero-WTC legacy fallback builder, MANDATORY].** A legacy merged-row job has
  `job._wtcs.length === 0` (loadJobs returns `_wtcs: []` for rows with no `job_wtcs` children,
  `queries.js:112-113`). With only the per-WTC `.map`, such a job opens to **zero tabs / zero
  builders → uneditable from the card** — and the card is the only surface users reach (JobDetail
  Planning is reverted in step 3). It would also strand the §7.1-allowlisted `jobs.field_sow` writer
  (UI-unreachable). Add the fallback (mirror `JobDetail.jsx:472-483`): when `job._wtcs.length === 0`,
  render **ONE** `FieldSowBuilder` bound to `job.field_sow`, saving via
  `updateJobField(job.job_id, 'field_sow', next, changedBy)`. This is the SAME allowlisted legacy
  writer as JobDetail's fallback (§7.1) — keep it inside the `length === 0` branch only.

- **[Finding F — Option 1 + popup, LOCKED (Chris); design call in §3 "Readiness-display authority"].** When a SOW save **empties** the SOW of a
  job that is currently **Ready** (`job.ready_confirmed_at != null`), the card SOW-modal save handler
  ALSO, in the **same save flow**:
  - (a) clears `ready_confirmed_at` via a **targeted handler-side write**
    (`updateJobField(job.job_id, 'ready_confirmed_at', null, changedBy)`) — a handler-side clear, NOT
    a new DB trigger. (The DB fn's auto-demote on assignments/materials writes stays the backstop, but
    a SOW-empty doesn't touch `assignments`/`materials`, so without this clear the flag would go
    stale.) "Empties" = after this save the §4.1 `hasFieldSow(job)` predicate is false (this WTC went
    to `[]` AND no other WTC has SOW AND no parent `jobs.field_sow`).
  - (b) fires a toast/popup: **"All SOW removed — this job has moved back to Staged."** The pre-Ready
    stage label is **"Staged"** (verified: `Jobs.jsx:428` renders the tab/stage label as `'Staged'`;
    the internal stage key is lowercase `'staged'`, `Jobs.jsx:11`, displayed `STAGED` in
    `StageJobCard.jsx:117`). Removing SOW demotes Ready → Staged.
  Keep this minimal and scoped to the card SOW-modal save path. Do NOT add a trigger.

**Step 2 — "Dates TBD" badge on `StageJobCard` (+ tile checklist). (#11/SCH4)**

**Step 3 — revert JobDetail Planning Field SOW tab + remove live `mode=planning` deep-links.**
Verified targets:
- Remove the Field SOW tab render block `JobDetail.jsx:448-494`.
- Remove/neutralize the planning-tab-group gate `JobDetail.jsx:193` (`mode !== 'management'`) and the default-tab branch `JobDetail.jsx:86` (`mode === 'planning' ? 'fieldsow' : 'overview'`) so no `mode=planning` resolves to a SOW editor; `:53` reads the `mode` param.
- Remove the live deep-link: `JobCardList.jsx:258` ("Job Planning" → `?mode=planning`).
- **DELETE `src/components/ScheduledCardList.jsx`** — it is DEAD (zero importers). Its `:148/159` `mode=planning` links are unreachable; do NOT spend revert effort treating them as live.

**Step 4 — DAYS modal + crew-view scope field read canonical (Finding D). (#9)**

`DaysModal.jsx` is **already read-only** (verified: no write path; `effectiveStart`/`effectiveEnd` read
job-level `scheduled_start`/`start_date`/`scheduled_end`/`end_date`, `DaysModal.jsx:5-6`; renders one
flat `workingDays` list from the job span, `:16-36`). The no-write half of Option 3 is therefore
already clean. The **"focus on day/WTC" half does NOT exist yet** and must be built:

- **DaysModal has no per-WTC day shape.** Today `workingDays(start, end, …)` derives a single flat
  list from the **job-level** span (`DaysModal.jsx:33-36`); there is no per-WTC grouping and no `wtc.id`
  on any row. **Spec:** rebuild DaysModal to read canonical **per-WTC `job._wtcs[*].field_sow`** day
  rows (each WTC's `field_sow` array carries `date`/`day_label` — `FieldSowBuilder` clean shape,
  `FieldSowBuilder.jsx:120-141`), grouped under each WTC's `work_type_name`, with TBD state surfaced
  per day (`date == null` ⇒ TBD, mirroring `FieldSowBuilder.jsx:185`). **Each rendered day row is
  tagged with its `wtc.id`** (and its day index within that WTC).

- **The SOW modal accepts no focus params today.** The new in-card SOW modal (step 1) must accept
  `initialWtcId` and `initialDayIndex`: on open, the WTC-tabs container selects the tab whose
  `wtc.id === initialWtcId` (falls back to first tab if absent), and the active `FieldSowBuilder`
  scrolls/focuses `initialDayIndex` (best-effort; no hard requirement to deep-scroll if the index is
  out of range).

- **Close-one / open-other handoff (was unspecified).** A DaysModal day-row `onClick` must:
  (1) close DaysModal (`setShowDaysModal(false)` in `StageJobCard`, the owner of both modal toggles —
  `StageJobCard.jsx:379` `showDaysModal`, `:523` `showSowModal`); (2) open the SOW modal with
  `initialWtcId = row.wtc.id`, `initialDayIndex = row.dayIndex`. Both toggles live on `StageJobCard`,
  so the handoff is local card state — no router navigation needed. The DAYS modal still performs
  **no SOW/date write** — it only triggers this navigation. Do NOT add a DaysModal write path.

- Crew-view scope field reads canonical.

**Step 5 — strip `FieldSowModal` edit path + port Print to canonical `_wtcs` (Fold O1). (#6/#8)**
- Remove the Edit/Save UI and `handleSave` (`FieldSowModal.jsx:83-97`, which writes
  `supabase.from('jobs').update({ field_sow })` at `:92`, verified), plus the `editing` state
  (`:27`), the empty-state "Create Field SOW" path that sets `editing` (`:36-51`), the Edit button
  (`:174`), all `editing ?` branches in the render (`:256-368`), and `handleCancel` (`:99-102`).
- **Keep Print only** (`handlePrint`, `FieldSowModal.jsx:105`). **[Fold O1 — Print must flatten the
  per-WTC canonical shape].** Today the Print body reads the **flat** `job.field_sow` via
  `viewDays = … job.field_sow` (`FieldSowModal.jsx:159`) and `.map`s it (`:253`). Canonical SOW now
  lives in `job._wtcs[*].field_sow`. Re-source Print to iterate `job._wtcs`, emitting a **per-WTC
  section header** (`work_type_name`) followed by that WTC's `field_sow` days, then the next WTC.
  Legacy zero-WTC jobs (`_wtcs.length === 0`) fall back to the flat `job.field_sow` (so legacy print
  still works). The print CSS day/material markup is unchanged — only the data source + per-WTC
  section headers are added.
- **[Fold O1 — Print entry point].** After the edit path is stripped, nothing in the new step-1 SOW
  modal opens this Print view, so Print would be orphaned. Add a **"Print PDF" button in the new
  in-card SOW modal** (step 1) that opens `FieldSowModal` (now Print-only) for the job. (`FieldSowModal`
  becomes the print-render surface; the step-1 modal is the editor surface. They are distinct modals;
  the editor modal's Print button mounts the Print-only `FieldSowModal`.)
- After this, `FieldSowModal` has **NO write path** to `jobs.field_sow`.

**Step 6 — re-smoke the full Sales→Schedule path from the card flow.**

## 7. Acceptance criteria (new — entry-point coverage)

### 7.1 `jobs.field_sow` writer allowlist
After this remediation, exactly **ONE** code path may write `jobs.field_sow`, and it is the documented legacy/mirror fallback:

- **ALLOWED (two legacy-fallback `field_sow` writers, both `_wtcs.length === 0` only):**
  1. `JobDetail.jsx:480` — `updateJobField(job.job_id, 'field_sow', next, ...)` in JobDetail's legacy
     fallback branch (the `job._wtcs.length === 0` else-branch). *(Note: with the live `mode=planning`
     deep-link removed in §6.1 step 3, this is reachable only via the surviving mgmt-mode tab routing;
     it stays allowlisted as the documented legacy writer.)*
  2. **NEW (Finding E)** — the **card SOW modal's** legacy fallback (`StageJobCard` host), same call
     shape `updateJobField(job.job_id, 'field_sow', next, changedBy)`, in its own `job._wtcs.length === 0`
     branch. This is the card-reachable legacy writer (§6.1 step 1 Finding E). Both are the SAME
     documented legacy/mirror path, gated on zero `job_wtcs` children.
- **ALSO ALLOWED (not a `field_sow` write — adjacent, Finding F):** the handler-side
  `updateJobField(job.job_id, 'ready_confirmed_at', null, changedBy)` demote in the card SOW save path.
  It writes `ready_confirmed_at`, NOT `field_sow`, so it is outside the `field_sow` allowlist entirely
  and does not trip the grep gate below.
- **FAIL (must be zero after build):** any `jobs.field_sow` write outside the two `_wtcs.length === 0`
  fallback branches. Specifically the current `FieldSowModal.jsx:92` (`supabase.from('jobs').update({
  field_sow })`) MUST be gone (§6.1 step 5); and the per-WTC card builders MUST write `job_wtcs` via
  `updateJobWtcFieldSow`, never `jobs.field_sow`.

**Grep gate (precise enough to distinguish allowlisted legacy writers from a regression):**
```bash
# 1. All jobs.field_sow writes via .update():
grep -rn "update(.*field_sow" src/
#    → MUST return ONLY the two legacy-fallback updateJobField calls (JobDetail + the new card-modal host),
#      each inside a job._wtcs.length === 0 branch. Zero hits in FieldSowModal / the per-WTC builder path = pass.
# 2. Any raw supabase write to the jobs table carrying field_sow:
grep -rnE "from\('jobs'\)\.update\(.*field_sow|update\(\{[^}]*field_sow" src/
#    → MUST NOT hit FieldSowModal.jsx; MUST NOT hit any new StageJobCard SOW-modal file (the card writes job_wtcs, not jobs).
# 3. Canonical writer is reused, not re-implemented:
grep -rn "updateJobWtcFieldSow" src/
#    → the card SOW modal's per-WTC builders MUST call this; raw from('job_wtcs').update() outside queries.js = fail.
# 4. [Fold O3] No inline SOW null-checks survive outside the hasFieldSow helper:
grep -rnE "field_sow\s*[!=]=\s*null" src/ | grep -v "queries.js"
#    → MUST be empty. All four JS readers (baseChecklistPasses, JobsPicker:34, StageJobCard:111, :206)
#      route through hasFieldSow(); the only field_sow null-test lives in queries.js's hasFieldSow.
```
The distinguisher: a `field_sow` hit is allowlisted ONLY if it is an `updateJobField(..., 'field_sow', ...)` call inside a `_wtcs.length === 0` fallback branch (JobDetail or the card host). A `from('jobs').update({ field_sow })` anywhere, any `field_sow` write outside those two branches, or any inline `field_sow == null` SOW-check outside `hasFieldSow`, fails the gate.

### 7.2 Per-surface enumeration — each REWIRE/UPDATE asserts `job_wtcs` change + `job_changes` audit row
For each surface from §4 that edits SOW/dates, the acceptance test asserts BOTH a `job_wtcs` mutation AND a `job_changes` audit row (the `updateJobWtcFieldSow` path inserts `field = 'job_wtc.field_sow:<id>'`, verified `queries.js:530`):

| Surface (§4) | Action | Assert `job_wtcs` change | Assert `job_changes` audit |
|---|---|---|---|
| StageJobCard SOW modal — per-WTC `FieldSowBuilder` (§6.1 step 1) | save SOW for a WTC | `job_wtcs.field_sow` (+ derived `start_date`/`end_date`) updated for that `wtc.id` | one row, `field = 'job_wtc.field_sow:<wtc.id>'`, `source='schedule_command'` |
| Multi-WTC job (N tabs) | save on tab 2 | only tab-2's `job_wtcs` row changes | one audit row keyed to tab-2's WTC; tab-1 untouched |
| `baseChecklistPasses` / `isReady` (JS) + `job_base_checklist_passes` (SQL) | add SOW to a WTC of a Staged job | the WTC-aware predicate now returns SOW-present; tile/gate flip without writing `jobs.field_sow` | n/a (read gate) — but the SOW write that triggered it produced its `job_wtcs` audit row above |
| **SOW-empty demote (Finding F)** — card SOW save that empties a **Ready** job's last SOW | clear SOW on the only WTC of a Ready job | the WTC's `field_sow` → `[]` (one `job_wtcs` change) **AND** `jobs.ready_confirmed_at` → null (handler-side `updateJobField`) | TWO rows from this flow: `field='job_wtc.field_sow:<wtc.id>'` (the SOW write) **and** `field='ready_confirmed_at'` (the demote write); toast "moved back to Staged" shown; no DB trigger involved |
| DaysModal (read-only overview, click-to-edit deep-link — Finding D / Option 3) | open on a multi-WTC job; click a day row | DAYS modal writes **nothing**; clicking a day **navigates** to the SOW modal, where any edit goes through `updateJobWtcFieldSow` | **zero** `job_changes` rows from DaysModal itself; the audit row (if the user then edits) is produced by the SOW modal, not DaysModal |

### 7.3 Coverage / revert assertions
- Editing SOW from the **staged card** updates `job_wtcs`, reflected in card + DB (not `jobs.field_sow`).
- "Dates TBD" badge shows on the staged card for a TBD WTC.
- No reachable JobDetail Planning Field SOW editor remains (`mode=planning` resolves to nothing SOW-editing; `JobCardList:258` link gone; `ScheduledCardList.jsx` deleted).
- The Staged→Ready gate (JS + SQL) agrees on SOW-present for a WTC-only job (no parent `jobs.field_sow`).
- **[Finding A — empty-array JS↔SQL parity assertions]** (the prior parity test used a NON-empty WTC and
  would miss this):
  - **Empty-array WTC** — a `job_wtcs` row with `field_sow = '[]'` (the NOT-NULL default) and no parent
    `jobs.field_sow`: JS `hasFieldSow(job)` returns **false** AND SQL `job_base_checklist_passes`
    returns **false** for the SOW gate (`jsonb_array_length('[]') = 0`). Neither says "ready."
  - **Parent-`[]` legacy job** — a zero-`job_wtcs` job whose `jobs.field_sow = '[]'` (non-null empty
    array): both JS (`job.field_sow != null` ⇒ true) and SQL (`p_job.field_sow IS NOT NULL` ⇒ true)
    treat it as SOW-present, per the legacy-parent branch's intentional `IS NOT NULL` semantics (§4.1).
  - **Non-empty WTC** (the existing test) — JS=true AND SQL=true. All three cases agree across JS/SQL.
- **The DAYS modal has zero SOW/date write paths** — it only navigates to the canonical SOW modal (Option 3). Grep-confirm no date write exists outside `updateJobWtcFieldSow`: `DaysModal.jsx` (and its handlers) contains no `from('job_wtcs').update`/`from('jobs').update` carrying `field_sow`, `start_date`, or `end_date`; the only date-write path in the codebase is `updateJobWtcFieldSow` (which derives dates from `field_sow[*].date`).

## 8. Process fix (so this class can't recur) — enforceable gate (Fold O2)

Prose alone is what let this slip. Concrete, checkable gate. **A plan that touches a shared data field
does not pass `/auditcriteria` until every box is checked in the plan doc:**

- [ ] **Entry-point inventory present.** A table listing EVERY surface that reads or writes the touched
  field, each with a **verified `file:line`** and a disposition (`REWIRE` / `LEAVE` / `RETIRE` /
  `DELETE`). The recurrence vector here was a SOW *reader* (the readiness gate) with no inventory row.
- [ ] **Grep-derived, not memory-derived.** The inventory was built by running and pasting the grep:
  `grep -rn "<field>" src/` (+ the SQL mirror: `grep -rln "<fn_or_field>" supabase/migrations/`). Include
  the command + that it was run. Both JS **and** SQL surfaces enumerated.
- [ ] **Dead-code check.** Every "deep-link / consumer" surface was confirmed live via
  `grep -rn "import.*<Component>\|<<Component>" src/` — zero-importer files are marked DELETE, not REVERT.
- [ ] **Canonical-write allowlist.** A `file:line` allowlist of every permitted writer of the field, with
  a grep gate precise enough to distinguish the allowlisted writer from a regression (see §7.1).
- [ ] **Design-baseline check.** Named the current production design doc and confirmed the touched
  surfaces are the ones users actually reach (not a retired screen) — the §2 root cause.

`buildvsplan` adds an **entry-point-coverage** pass: re-run the inventory grep against the built diff and
confirm no SOW-touching surface writes the non-canonical field outside the allowlist (not just spec-vs-code).

## 9. Not affected by this remediation
- **Sales S1–S4** (sales-command WTCCalculator/ProposalDetail) — verified; the design issue is
  Schedule-only.
- **Migrations** `20260612120000` (job_wtcs nullable) + `20260613120000` (proposal_wtc.dates_tbd) —
  applied to prod; unchanged.
- **Field F1–F3** — deferred to Field launch (backlog D1). Fold O1: the specific Field surface this
  remediation does **not** touch is **`TasksTab`** (Field Command's day/task editor). It reads `job_wtcs`
  via PowerSync; once Schedule writes canonical per-WTC SOW correctly (the fix here), `TasksTab` consumes
  it unchanged. No edit to `TasksTab` is in scope; "Field not affected" is scoped to that component, not a
  blanket claim about the Field app.

## 10. Captured findings rolled into this remediation
Bugs: #7 (MaterialsModal closes per-edit — separate, not SOW), #8 (FieldSowModal input truncation →
folds into editor rebuild). Enhancements: #1 carry material specs, #2 menu-first task + 100% cap,
#3 ordered-qty header, #4 completeness gate, #5 burden-rate law, #6 FieldSowModal WTC-aware/date-
grouped, #9 crew-view scope clickable, #10 staged-card→canonical editor (this), #11 badge on staged
card (this). #6/#8/#10/#11 are the consolidation; #1–#5/#9 remain design-pass items.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-15 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 1 found the big miss — a "is the SOW done?" check (the Staged→Ready gate) that everyone forgot was reading the SOW, in both the app code and the database. The plan now fixes it. This round confirms the inventory is finally complete and checks the one new moving part: a database-function change that has to stay in lock-step with the app code, built on the *right* version of that function (an earlier copy would quietly break the crew-readiness check). Three reviewers, still weighted on "did we find every screen."

### Round
- Current round: 2
- Plan revision under audit: `14c12e4`
- Findings trend: round 1 (12 deduped: 5H/4M/3L) → round 2 (?) — coverage gap addressed; this round verifies completeness + the new SQL-fn migration the fix introduced.

### Prior rounds
- Round 1: `1392dc7` · 5H/4M/3L (12 deduped) · pattern: `entry-point-coverage-gap`

**Briefing for agents**: do NOT re-find round-1 issues. Round-1 fixes (commit `1392dc7` + Option-3 follow-up `14c12e4`): **A** — the MISSED Staged→Ready readiness gate added to §4; all four `jobs.field_sow` readers (`baseChecklistPasses`/`isReady`, `JobsPicker:34`, `StageJobCard:111`, `:206`) + the SQL `job_base_checklist_passes` unified on ONE WTC-aware predicate (§4.1); **B** per-WTC `FieldSowBuilder` loop + reused `proposal_wtc_id` materials loader + WTC-tabs container; **C** `ScheduledCardList` confirmed DEAD → DELETE, real revert targets are `JobCardList:258` + JobDetail (`:448-494/:193/:86`); **D** `FieldSowModal` edit/handleSave stripped → Print-only; **E** §7 `jobs.field_sow` writer allowlist + per-surface `job_wtcs`+`job_changes` enumeration; **F→Option 3** — DAYS modal is a read-only overview whose day rows **deep-link** into the SOW modal (no DAYS write path; single write *function*). This audit must STAY design-baseline + entry-point-coverage aware (the parent's 3 spec-vs-code rounds missed the original design mismatch). Verify the §4 inventory is NOW complete and the JS↔SQL predicate parity holds.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant blocked.
- **Prod / staging / dev**: Schedule Command live; the `StageJobCard` / staged-ready-cards design IS the production surface. The `job_wtcs` SOW write path is net-new and was **BROKEN** at round 0 (smoke failed — real edits hit `jobs.field_sow`, not canonical `job_wtcs`).
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 office on web.

Severity caps: cross-tenant → **Med**; race → **Low**. NOTE: this fixes a **confirmed-broken** path (smoke failed), so "an editor writes the wrong table / a surface is missed / JS-SQL predicate disagree" findings are real **CAUSED-BY**, not theoretical.

### Time budget + finding cap
- **Time budget**: not ERD-locked (focused remediation).
- **Finding cap**: **6**.

### Surface
- Total lines: 283
- Sections: 11
- [LOCKED] decisions: 6 (incl. §3 design authority, §4.1 shared predicate, WTC-tabs container, F=Option 3)
- [DESIGN-OPEN] items: 0 (F resolved → Option 3)
- [OPEN] items: 0
- Plan-to-code ratio: ~283 plan : est ~250–450 code (rewire + 1 SQL-fn migration) ≈ healthy

### Layers touched
- UI / components (StageJobCard SOW/DAYS chips + in-card modal, FieldSowModal Print-only, FieldSowBuilder per-WTC + WTC tabs, DaysModal deep-link, JobDetail revert, tile checklist)
- Data layer (`queries.js` `updateJobWtcFieldSow` reuse, the new shared `hasFieldSow` predicate helper, `loadJobs({withWTCs})`)
- State model (`job_wtcs` canonical vs `jobs.field_sow` legacy mirror; the readiness predicate)
- **Migrations / schema (NEW this round)** — a migration redefining the SQL fn `job_base_checklist_passes` (the SOW-present test → WTC-aware), coupled to the JS edit
- Audit logging (`job_changes` rows asserted per surface, §7.2)

### New mechanisms introduced
- **New migration** — redefine `job_base_checklist_passes` (SQL) to the WTC-aware SOW EXISTS check, **based on the `...133000` body** (assignments-based crew check) — dashboard-apply + ledger-repair.
- **New shared helper** — `hasFieldSow(job)` in `queries.js`, the single WTC-aware SOW-present predicate all four JS readers import (§4.1).
- Rewire: per-WTC `FieldSowBuilder` loop inside the `StageJobCard` SOW modal; **WTC-tabs** container; `FieldSowModal` → Print-only (edit path stripped); DAYS modal day-row → SOW-modal deep-link (Option 3).
- Process: planning gate (surface/entry-point inventory + design-baseline check); `buildvsplan` gains entry-point-coverage (§8).

### Cross-system reach
- Schedule-only this remediation (§9: Sales S1–S4 unaffected/verified; Field narrowed to `TasksTab`, deferred to backlog D1).
- Touches canonical `job_wtcs` (shared DB) Field will read — Field deferred, no live cross-repo consumer this round.

### Irreversibility
- **One migration** — the `job_base_checklist_passes` redefine (replaces an existing fn body; cross-repo ledger-coordinated, dashboard-applied + `migration repair`). Reversible by redefining back, but a wrong base body (`...120000` not `...133000`) silently regresses the crew-readiness check.
- No backfills; no new columns; rest is UI rewiring.

### Known weak points
- **Entry-point coverage completeness (STILL the crux):** round 1 caught one missed SOW surface (the readiness gate). VERIFY the §4 inventory is now EXHAUSTIVE — grep every `field_sow`/`job_wtcs` read+write; find ANY remaining surface not listed or still treating `jobs.field_sow` as canonical.
- **JS↔SQL predicate parity (NEW, the coupled-change risk):** the `hasFieldSow` JS helper and the redefined `job_base_checklist_passes` SQL must encode the SAME WTC-OR-parent logic; if they drift, tile/gate and DB disagree. And the SQL redefine MUST start from `...133000` (assignments crew check) — `...120000` loses it.
- **`FieldSowModal` strip leaves no writer:** edit/handleSave removed, Print-only reading `_wtcs` — confirm zero residual `jobs.field_sow` write.
- **Option-3 DAYS deep-link wiring:** the day-row click must open the SOW modal focused on that day's WTC, and the DAYS modal must hold no write path of its own (§7.3 grep assertion).
- **JobDetail revert completeness:** the real targets (`JobCardList:258`, JobDetail `:448-494/:193/:86`); `ScheduledCardList.jsx` DELETED — confirm no `mode=planning` resolves to a SOW editor.
- **Grep-gate precision (§7):** must distinguish the ONE allowlisted legacy writer (`JobDetail.jsx:480`, `_wtcs.length===0` fallback) from a regression — false-pass risk.

### Open questions
- Count: 0 design-open. Round 2 = verify completeness + the new SQL-fn migration parity.
- Highest-pressure: is the §4 inventory NOW exhaustive, and do the JS + SQL predicates match?

### Suggested attack angles (3 total)
1. **Entry-point coverage completeness (STILL the crux)** — covers UI + State model. Reading: grep every `field_sow`/`job_wtcs` read+write across sch-command `src/`; the §4 inventory + §4.1 predicate; `JobsPicker`, `StageJobCard`, `DaysModal`, `FieldSowModal`, crew-view, tile checklist. Pressure: round 1 found ONE missed surface — find another, or prove the inventory is exhaustive. Do all four JS readers now route through the shared predicate? Any surface still keying on `jobs.field_sow` alone?
2. **SQL-fn migration + JS↔SQL predicate parity** — covers Migrations + Data layer + State model. Reading: `20260528133000_*` + `20260528120000_*` (the two `job_base_checklist_passes` defs), the planned redefine, `queries.js` `hasFieldSow`/`baseChecklistPasses`, RESUME ALERT/ledger discipline. Pressure: is the redefine based on `...133000` (keeps assignments crew check)? Do JS and SQL encode identical WTC-OR-parent logic? Migration-ledger / collision discipline followed? 3VL edge cases (empty array vs null).
3. **Rewire + Option-3 deep-link + `FieldSowModal` strip** — covers UI / components + audit logging. Reading: `staged_ready_card_design.md` (§3.5/§376), `StageJobCard`, `FieldSowBuilder` (sig `{value,onSave,saving,availableMaterials}`), `DaysModal`, `FieldSowModal`, JobDetail revert sites, `queries.js:500` `updateJobWtcFieldSow`. Pressure: per-WTC builder in WTC tabs (state/save/close per tab); does the DAYS day-row deep-link land on the right WTC/day with no DAYS write path; does the `FieldSowModal` strip leave zero `jobs.field_sow` writes; is the JobDetail revert complete; per-surface `job_changes` audit-row assertions (§7.2) sound.

### Suggested agent count: 3

Rationale: round 1 surfaced 5 Highs and the coverage crux remains; the new SQL-fn migration adds a real JS↔SQL-parity + wrong-base-body risk worth a dedicated agent. 3 (coverage / migration-parity / rewire) — not down to 2 yet given the High count and the new migration.
