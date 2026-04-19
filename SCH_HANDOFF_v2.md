SCH_HANDOFF_v2 — April 18, 2026
Session: Job Planning workflow, readiness checklist, crew scheduler UX

===============================================================================
WHAT WAS DONE
===============================================================================

1. Job Detail — Tab Groups (COMMITTED)
   - Split 6 flat tabs into two labeled groups:
     - JOB PLANNING: Schedule, Materials, Field SOW
     - JOB MANAGEMENT: Overview, Billing, History
   - Parked jobs default to Schedule tab; active jobs default to Overview
   - File: src/views/JobDetail.jsx

2. Readiness Checklist (COMMITTED)
   - Parked jobs show a checklist between tab groups and content
   - Three requirements: Schedule (crew assigned), Materials (decided + fulfilled),
     Field SOW (exists with days)
   - Each item is clickable — navigates to the relevant tab
   - Materials has a quick toggle: "Needed" / "Not Needed" buttons
   - "Send Job Plan to Schedule" button at bottom — disabled until all 3 are ready
   - DB change: added `materials_needed` boolean column to `jobs` table (via SQL Editor)
   - File: src/views/JobDetail.jsx, src/App.css

3. Parked Card Simplification (COMMITTED)
   - Removed expand/collapse from Parked job cards
   - Added direct "View Detail" button on the card face
   - Removed "Confirm & Schedule" from the card — it now lives inside Job Detail
     as "Send Job Plan to Schedule"
   - File: src/views/Jobs.jsx

4. Crew Scheduler UX Overhaul (COMMITTED)
   - Added "JOB SCHEDULE DATES" banner — dark background, teal dates, day count
   - Replaced red busy dots with checkmark system:
     - Green checkmark on dark bg = booked (this job or other)
     - Green circle = available
   - All crew members always visible in picker (never filtered out)
   - Hover tooltips show which job a crew member is on
   - Plus buttons: black background with green "+"
   - Crew name pills: black background with green text
   - Day/date headers: bigger (12px), darker text for readability
   - File: src/components/JobCrewScheduler.jsx, src/App.css

5. Dev Environment Setup
   - Schedule Command running at localhost:5173
   - Sales Command running at localhost:5174
   - Field Command built and installed on iPhone 17 Pro simulator (iOS 26.4)
   - Test job created: 10044 - "Field Sow to Field Command to PRT report" ($11,006)
     - Status: Parked in Schedule Command
     - Crew assigned: Bash Dave (Mon-Fri), Jose (Mon-Fri), Adam Little (Mon-Fri)
     - Others have assignments from other jobs visible via checkmarks

===============================================================================
KNOWN BUGS (noted for later)
===============================================================================

- Sales Command WTC: step tabs (1-6) get clipped at smaller window widths,
  no way to navigate to later steps. Needs horizontal scroll or wrap.
  (Saved to memory: project_sales_command_bugs.md)

===============================================================================
WHAT WAS NOT DONE
===============================================================================

- Did not test full Sales → Schedule → Field pipeline end-to-end
  (job is Parked, not yet sent to Schedule/Field)
- Did not verify Field Command receives jobs via PowerSync
- The core blocker from v5 handoff still exists: Field Command HomeScreen
  queries call_log WHERE stage IN ('Scheduled', 'In Progress'), but that
  requires "Send Job Plan to Schedule" to update call_log.stage
- Did not push to GitHub yet

===============================================================================
DATABASE CHANGES
===============================================================================

Column added (via Supabase SQL Editor):
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_needed boolean DEFAULT null;

===============================================================================
NEXT SESSION — PRIORITIES
===============================================================================

1. Finish crew assignment for test job 10044, mark materials, review Field SOW
2. Click "Send Job Plan to Schedule" — verify call_log.stage updates
3. Check Field Command simulator — does the job appear?
4. If not, debug PowerSync sync rules vs call_log.stage values
5. Test time punch + daily production report in Field Command

===============================================================================
FILES CHANGED (sch-command repo)
===============================================================================

src/views/JobDetail.jsx     — Tab groups, readiness checklist, send plan button
src/views/Jobs.jsx          — Simplified Parked cards, View Detail button
src/components/JobCrewScheduler.jsx — Date banner, checkmarks, tooltips, all-crew picker
src/App.css                 — All new styles for above features

Commit: cb16050

===============================================================================
BUILD / RUN (quick reference)
===============================================================================

Schedule:       cd ~/sch-command && npm run dev        (localhost:5173)
Sales:          cd ~/sales-command && npm run dev       (localhost:5174)
Field Command:  cd ~/field-command && npx expo run:ios
                Cmd+R in simulator for JS-only hot reload
