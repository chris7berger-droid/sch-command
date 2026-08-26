# SCH_HANDOFF_v36 — Home redesign (charcoal/linen/teal shell + dashboard) BUILT, on branch

**Repo:** sch-command · **Branch:** `feat/home-redesign` (worktree `~/sch-command-home-redesign`) · **Date:** 2026-08-26
**Status:** BUILT + localhost-verified + all 3 review gates green + fixes applied. **NOT merged, NOT pushed, NOT deployed.** Build terminal stopped at the correct line.
**Plan:** `docs/plans/home-redesign.md` (Option B, 3 audit rounds, build-ready). **Mockup (visual truth):** `docs/plans/assets/home-redesign-mockup.png`.

> **Numbering note:** this is **v36** — v35 is the last on `main`; v34 is claimed by the parallel `feat/daily-view-rebuild` branch. No collision with either.

> **Why "is it safe to close?" was asked twice (Chris flagged it):** the build + all three gate cycles happened in *this one terminal* (T4/T5/T6 outputs were pasted back in, not separate live sessions), and their perspectives lived only in chat scrollback until this doc. This handoff is late — it should have been written before declaring the work done. §3 captures each gate's verdict so nothing is lost when this terminal closes.

---

## 1. Session summary

Built the **Schedule Command Home redesign** end-to-end on `feat/home-redesign`: a new charcoal/warm-linen/teal dashboard screen plus an app-shell reparent (left sidebar replaces the top nav). Functional source of truth = the existing `/jobs` screen (job-card logic, STAGED/READY derivation, filters, actions, routes all preserved); visual source of truth = the Option B mockup, built literally (true-dark panels, warm-linen page, teal primary, green/orange/red/purple signals, compact rows).

Went build (`0ea47e0`) → **T4 buildvsplan (0 blockers, smoke GO)** → **T5 code-review (7 findings, 0 blockers)** → **T6 security-review (0 exploitable-today)** — all green — then folded T4+T5 into one batched fix pass (`50d2ed2`). `vite build` clean; verified in the live browser against the mockup (Home, `/jobs`, `/schedule`, row expand, ACTIONS menu), zero console errors. **UI + read-only queries only — no migration, no writes, no RLS/policy/edge-fn touch.** Work is committed on the branch only; not merged/pushed/deployed — that's Chris's next decision (§8).

## 2. Changes shipped (branch `feat/home-redesign`, local only)

- `0ea47e0` **Home redesign build** — the feature:
  - **§11 `queries.js`:** exported `effectiveStart`/`effectiveEnd`/`stageOf` (retires 5 duplicate copies + AllJobsList's private `stageOf`); new `computeHomeDashboard` with TWO crew maps — Mon–Sat week window (capacity/needs-crew/per-day) and own-dates/all-time (`isReady` + not-ready, so Home agrees with `/jobs`). `job_crew` used nowhere; `crew_needed` `parseInt||0`; Assigned = distinct-crew Set (not summed); completion denom/numerator guards; week reads date-bounded.
  - **§12/§12.1 `App.jsx`:** sidebar REPLACES the top nav (route-aware `useLocation`); `/schedule` renders a collapsed 64px icon-rail so nav isn't stranded; header collapses 8 buttons → `+ JOB` / `ACTIONS ▾` + greeting; Sign Out moved to sidebar user card; `/home` route + `/`→`/home`; StatsBar gated off `/home`.
  - **§13 theme:** Home-scoped tokens in `index.css` (`.home-screen`: lighter linen, creamy cards, `--panel-dark #111110`, teal primary, `--teal-ink` for teal-on-light); global `--header-dark` untouched; 6 chrome rules repainted green→teal.
  - **§14 Jobs to Prepare:** single list + `ALL STAGES ▾`, month default, `home-compact` conditional early return in `StageJobCard` (default `/jobs` path untouched), real per-stage action on row (active = neutral spacer), 25-of-N cap, auto-fit widening.
  - New components: `Home.jsx`, `HomeCapacityStrip.jsx`, `HomePanels.jsx`, `JobsToPrepare.jsx`.
- `50d2ed2` **Batched review fixes (T4 + T5):** #1 undated (null start+end) jobs no longer intersect every week; #2 Next Up 14-day past floor (no ancient job pinned) + accurate empty copy; #3 0-crew-needed reads "No crew needed" not red; #4 wall-clock "day N of M" (not UTC `toISOString`); #5 Actions dropdown outside-click dismiss; #6 `getMonday`/`fmtD`/`wkDates` centralized in `queries.js`; #7 per-day capacity uses precomputed `crew|date` Set (drops the O(n) `.some()`).

## 3. Gate record (all green — the review-terminal snapshots)

- **T4 buildvsplan (`0ea47e0`):** **0 Tier-1 blockers, SMOKE = GO.** Live-schema probe: every column the dashboard reads returned 200; no migration. 3 Tier-2 (all number-semantics *calls*, not defects) + 4 Tier-3 (deferred/pre-existing). Verdict: faithful implementation of the plan.
- **T5 code-review (`0ea47e0`):** **0 ship-blockers.** 7 findings (6 should-fix + 1 hardening) — **all 7 fixed in `50d2ed2`.** Confirmed clean: StageJobCard hook order safe, `/jobs` path genuinely untouched, conflict detection counts distinct `job_id`, completion null-span guards hold. Excluded (T4 do-not-refile list): unbounded assignments read (mirrors Jobs.jsx, pre-existing), crewAvailable=headcount semantics.
- **T6 security-review (`0ea47e0`):** **0 exploitable-today** (scored vs prod: 1 tenant HDSP, ≤5 authenticated office users). All new reads go through the shared RLS-scoped anon client (same path Jobs.jsx uses); URLs carry only ids/dates; rendering is auto-escaped (no `dangerouslySetInnerHTML`); access gate untouched. Nothing to fix.

## 4. Deployed

**Nothing.** No migration, no Vercel deploy, no shared-DB touch. UI + read-only queries only. This is branch work awaiting a merge/deploy decision (§8).

## 5. Decisions / choices made (the non-obvious ones)

- **Two semantics calls ratified as-built (Chris confirmed "keep both"):** (a) "Crew Available" badge = raw active headcount, not net-of-out — matches the mockup's pool→utilization framing, diverges from §11's literal wording; (b) per-day "X / N" denominator = crew−out (capacity), so X/denom reads as utilization %, matches the mockup's bar+%. Both diverge from the written §11 formula on purpose.
- **`.app-main:has(.sch-layout)` padding rule KEPT — declines T4 🟠3.** The plan (§12) said drop it "in favor of the rail layout," but that rule is the *full-bleed mechanism* for `/schedule` (padding:0 + overflow visible); dropping it re-adds 24px padding around the board. The rail only handles the horizontal sidebar. Verified full-bleed live. Informed override, not an oversight.
- **`/schedule` board-height `calc(100vh − 52px)` left as-is.** Pre-existing §15 item; board has its own internal scroll and renders correctly (the reparent actually freed ~40px by shrinking the header). A proper fix is a flex refactor of `/schedule` — out of this mandate and unreviewed by the gates.
- **Greeting rendered in the header via `useLocation` (home-only), not in the Home body** — follows §12 A3 literally.
- **Home panels built as new components** (`HomeCapacityStrip`/`HomePanels`/`JobsToPrepare`) so `Home.jsx` composes per CLAUDE.md ("page files are list views") — beyond the plan's §3 file list, which itself defers to that convention.

## 6. Backlog touched

- No backlog IDs closed (net-new feature work).
- §15 "adjacent" items remain filed/out-of-scope (not built this pass): `loadJobs` unpaginated vs 1000-row cap; `.sch-layout` height offset; StatsBar has no realtime on `assignments`. Global green→teal on the other 7 screens stays the deferred polish pass.

## 7. Verification

- **Done:** `vite build` exit 0 (3×); in-browser against the mockup (signed in as Chris) — Home charcoal/linen/teal fidelity, capacity strip + Next Up truly dark, compact-row inline expand→collapse, `/schedule` icon-rail + full-bleed board, `/jobs` unchanged (full original cards, no compact leak), ACTIONS ▾ menu holds all 6 relocated buttons; zero console errors on Home/`/jobs`/`/schedule`.
- **NOT done:** full end-to-end smoke against *realistic* prod-shaped data — the dev DB is sparse, so several numbers read as 0/edge (e.g. per-day 0/23, "No upcoming jobs need attention"); the *math* is verified, but real HDSP data hasn't exercised the panels. No Vercel preview deploy. Not merged, so no prod-shaped eyes-on.

## 8. Next / open (first action for next session)

Build terminal is done; the branch is at a clean stopping point. **Chris's decision — the work is committed on the branch only, invisible to main until merged.** Options:
- **Light re-gate then ship:** the fix pass (`50d2ed2`) touched the aggregate math, so one `/buildvsplan` on `50d2ed2` is cheap insurance, then merge `feat/home-redesign` → main. *(My lean.)*
- **Ship directly:** merge → main (+ optional Vercel preview deploy on the branch first for prod-shaped eyes).
- **Hold:** keep the branch open.
- Whatever the path: **the two build + fix commits are NOT on origin yet** — push the branch or merge, or the next session/machine can't see this work.

## 9. Files to probably know about next session

- `src/lib/queries.js` — `computeHomeDashboard`, `buildCrewByCallLog`, exported `stageOf`/`effectiveStart`/`effectiveEnd`/`fmtD`/`getMonday`/`wkDates`.
- `src/App.jsx` — the frame reparent (`.app-frame`/`.app-sidebar`/`.app-col`), `useLocation` route-awareness, ACTIONS dropdown + outside-click, sidebar user card.
- `src/views/Home.jsx` — screen composition + data load (mirrors Jobs.jsx loads + week-windowed crew/assignments).
- `src/components/HomeCapacityStrip.jsx` / `HomePanels.jsx` / `JobsToPrepare.jsx` — the new Home pieces.
- `src/components/StageJobCard.jsx` — the `home-compact` conditional early-return branch (default `/jobs` return untouched).
- `src/index.css` (`.home-screen` scope) + `src/App.css` (frame/sidebar/header/`.hcs-`/`.hp-`/`.jtp-` blocks appended at EOF).
- `docs/plans/home-redesign.md` — the contract (still marked Status: PLANNING; update to BUILT on merge).

## 10. Git state on close

- **Branch:** `feat/home-redesign` @ `50d2ed2` (this handoff commit will sit on top).
- **origin/feat/home-redesign** is **9 commits behind HEAD** — the merge, build, and fix commits are **local only, not pushed.**
- **origin/main tip:** `6f0bc5a` (Merge fix/field-sow-modal-width).
- **Working tree:** clean. `.env.local` present but gitignored (copied from `~/sch-command/.env.local` so the worktree could run — not committed).
- **Worktrees:** `~/sch-command` [main @ 6f0bc5a], `~/sch-command-home-redesign` [feat/home-redesign @ 50d2ed2].
- **Parallel branch (untouched):** `feat/daily-view-rebuild` (local + remote) — another session's stream.

## END STATE
**Built, localhost-verified, all 3 gates green, fixes applied — committed on `feat/home-redesign` only. NOT merged/pushed/deployed. Decision pending: re-gate `50d2ed2` then merge, ship directly, or hold.**
