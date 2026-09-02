# SCH_HANDOFF_v34 — Daily view rebuilt to match Apps Script prototype

**Repo:** sch-command · **Branch:** `feat/daily-view-rebuild` (NOT merged) · **Date:** 2026-08-13
**Preview:** https://sch-command-git-feat-daily-9d98a0-chris7berger-droids-projects.vercel.app/daily
**Prod/main:** untouched. Build session — did NOT deploy or merge. Holds at the build-vs-plan gate.

---

## What happened

A power outage killed an in-progress fix to the Schedule Command Daily view. That work was
**unrecoverable** — the tree was clean and identical to origin; no branch/stash/worktree/editor
backup survived. The old live `/daily` was a manual deploy of uncommitted work. So we rebuilt.

Ground-truth reference = the **Apps Script `rDaily()`** from the bound script on the
**"YES Schedule v2"** Google Sheet (Chris pasted the full HTML/JS). `src/views/Daily.jsx` was
rewritten as a faithful port.

## Changes on the branch (4 commits)

1. **Rebuild Daily view** (`04942ea`) — full port of `rDaily()`: job cards with a crew×day check
   grid (✓ / S / C / N / — / 2X), per-job ⚠ Gaps row, Sick/Call-In/No-Show/Available (Unassigned)
   sections, legend. `.dly-*` classes + linen palette scoped locally to the component.
   - **Week filtering by date-overlap** (only jobs scheduled this week) — fixed the old runaway
     "Unassigned (55)" dump.
   - **Crew names kept "Last, First"** (no flipping), matching the prototype.
2. **Doubled title fix** (`980fa86`) — `call_log.display_job_number` (→ `job_num`) is ALREADY
   `"<number> - <job_name>"`, so rendering `job_num - job_name` repeated the name on every card.
   `jobTitle()` now renders `job_num` alone when it already contains the name.
3. **Linen texture softened** (`94b6f75`) — crosshatch moved to a `::before` at opacity 0.5 with
   two warm radial washes (the original's exact recipe) so it reads as woven linen, not graph paper.
4. **Full-bleed linen** (`2450cbf`) — added `.app-main:has(.dly-v){padding:0}` (mirrors the
   existing `.sch-layout` full-bleed rule); split into a full-width `.dly-v` linen surface + a
   centered `.dly-inner` content column. Linen now runs edge to edge.

## State at close

- `vite build` green after every commit. Working tree clean, all pushed.
- Chris reviewed the preview and signed off on the look (titles clean, linen soft + full-bleed).
- **Not merged to main.** Next step when ready: build-vs-plan gate → merge → prod.

## Known / not-a-bug

- **Long job titles wrap to 2 lines.** The old sheet had short names ("Sysco - Naisbitt"); live
  Supabase data stores the full "Customer - Site - WorkTypes" in the name. That's the data, not the
  layout. Open call if Chris wants them trimmed short (would need a display rule: customer + short
  descriptor).
- **"Available (Unassigned)" shows the full roster** when few crew are assigned that week — faithful
  to `rDaily()`, data-driven, not a bug.

## Open thread (parked, NOT started)

Chris asked how the current Apps Script scheduling data gets into the new tool "when the time is
right" — not now. Answer given: the YES Schedule v2 sheet is portable (readable tabs: Jobs/Crew/
Assignments/CrewStatus/WorkTypes/Materials/Billing); when ready it's a one-time ETL mapping each tab
to its Supabase table (Jobs→jobs/call_log, Crew→crew, Assignments→assignments, CrewStatus→crew_status),
de-duped, scoped to what's "important" (active jobs + roster + live assignments; old completed jobs
can stay/archive). Shared prod DB → rehearse against a prod-shaped copy first (MIG-1 rule); wrinkle =
jobs hang off the `call_log` master. No plan doc written (Chris declined for now).
