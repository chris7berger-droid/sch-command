# Handoff — Schedule Commander v2

**Date:** 2026-03-26
**Last commit:** b597457 — Redesign Jobs view as health dashboard

## What Was Done This Session

### Jobs View Redesign (complete rewrite)
- **Removed** week navigation (Prev/Next/This Week)
- **Added** date filter bar with pill buttons: This Week / This Month / This Quarter / All Time / Custom date range
- **Replaced** 3-column layout (Ongoing/On Hold/Complete) with a **single job list sorted by urgency**
- **Scoreboards** (Ongoing / On Hold / Complete) still present, now respond to the active date filter
- **Job cards** now show:
  - Status badge (green=Ongoing, orange=On Hold, gray=Complete)
  - Job number + name
  - Work type tags, PW/NO BILL indicators
  - Progress bar for % billed
  - Contract value + amount billed ($X / $Y)
  - Days until end date (red if overdue, orange if <= 7 days)
  - Auto-flags: OVERDUE (red), UNBILLED (orange), READY TO INVOICE (cyan)
- **Click to expand** a job card inline — shows:
  - Full detail grid (start/end, lead, crew needed, vehicle, equipment, power source, contract)
  - Notes, SOW link
  - Status dropdown
  - % complete input + "Add to Bill List" button (inserts into billing_log)
  - Delete button (soft delete, 24hr restore)
  - Assignment history grouped by week

### Urgency Sort Logic
- Ongoing jobs first, then On Hold, then Complete
- Within each group: overdue jobs float to top, then sorted by days-until-end
- Unbilled jobs get a priority boost

### Environment
- Created `.env.local` with Supabase credentials (not committed)

## Files Changed
- `src/views/Jobs.jsx` — full rewrite (~370 lines)
- `src/App.css` — replaced Jobs View CSS section with new dashboard styles

## What's Next (not started)
1. **Test the Jobs view** — verify data loads, filters work, expand/collapse, Add to Bill List
2. **Schedule view** — crew grid board with drag-and-drop
3. **Billing view** — already has styles scaffolded, needs functional parity with Apps Script
4. **Materials, Calendar, Daily, Schedules** — remaining views per CLAUDE.md

## Known Issues
- None identified yet — needs live testing with real data
- `.env.local` must exist with valid Supabase credentials to run
