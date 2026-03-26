# Schedule Command

## What This Is
Schedule Command is a React + Supabase web app for YES, a construction subcontracting company (epoxy flooring, caulking, demo work). Part of the Command Suite alongside Sales Command (scmybiz.com). It replaces a live Google Apps Script version that the team uses daily. The v2 build runs in parallel — the Apps Script version stays live until v2 reaches feature parity.

## Team
- **Chris** — developer and primary user
- **Office staff** — Joe, John, Denise
- **Field manager** — Jonah
- **Field crew** — Troy + others

## Tech Stack
- **React** (Vite) — frontend
- **Supabase** — database and auth
- **GitHub** — version control (repo: chris7berger-droid/sch-command)
- **Vercel** — hosting (not yet set up)

## Supabase Project (shared with Sales Command)
- **Project ID:** pbgvgjjuhnpsumnowuym
- **URL:** https://pbgvgjjuhnpsumnowuym.supabase.co
- **Anon key:** in .env.local
- **Shared DB:** Both Schedule Command and Sales Command use the same Supabase project

## Environment Variables (.env.local)
```
VITE_SUPABASE_URL=https://pbgvgjjuhnpsumnowuym.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

## Supabase Client
`src/lib/supabase.js` — imports createClient, reads from import.meta.env

## Database Tables (all in public schema, RLS disabled for dev)
- **jobs** — job_id, job_num, job_name, start_date, end_date, status, crew_needed, work_type, vehicle, equipment, power_source, lead, notes, amount, prevailing_wage, partial_billing, partial_bill_date, partial_percent, billed_to_date, billing_paused, billing_notes, no_bill, no_bill_reason, sow, deferred_time, deferred_days, color, deleted, deleted_at
- **crew** — name, team, phone, archived
- **assignments** — job_id, crew_name, date
- **crew_status** — crew_name, status, date (unique on crew_name+date)
- **work_types** — name
- **materials** — job_id, ordinal, name, status, arrival_date, notes
- **billing_log** — job_id, date, percent, cumulative_percent, type, notes, invoiced, invoiced_date

## Design System (Command Suite)
Must match the visual design of Sales Command (scmybiz.com).

### Colors
- Background: warm linen tones — `#b5a896` (base), `#c8bcaa` (cards), `#a89b88` (deep) — NO white backgrounds
- Dark header/nav: `#1c1814`
- Header accent: teal `#30cfac` (header brand only)
- Content accent: Command Green `#5BBD3F` (buttons, tags, status indicators in content areas)
- Text: `#1c1814` (headings), `#2d2720` (body), `#6b6358` (light), `#887c6e` (faint/labels)

### Typography
- Display/headings: Barlow Condensed — bold, uppercase, letter-spacing 0.04-0.08em
- Body: Barlow — normal weight
- Numbers/mono: JetBrains Mono

### Components
- Cards: linen card background with `1px solid rgba(28,24,20,0.18)` borders, `border-radius: 10px`, `box-shadow: 0 2px 8px rgba(28,24,20,0.07)`
- Buttons: green accent for content, teal for header brand only
- Inputs: linen deep background, never white
- Pills/badges: colored border-left or background based on status

### General Rules
- Warm, muted, professional — NO bright whites, NO harsh borders
- Everything feels like linen/parchment with dark accents
- 1px borders, 8-10px border-radius, subtle box shadows
- Philosophy: "3 clicks through simple obvious screens beats 1 click on a complicated screen"

## Views To Build (in order)
1. **Jobs** — scoreboard (Ongoing/On Hold/Complete) + job list + job history drill-down
2. **Schedule** — crew grid board with drag-and-drop assignment, deferred start
3. **Billing** — 3-column RTB pipeline (Pending / Confirmed / Invoiced)
4. **Materials** — materials tracker per job with status
5. **Calendar** — monthly job date ranges
6. **Daily** — daily crew status grid
7. **Schedules** — mobile crew card flipper for copy/text

## Current Status
- Foundation complete — React app running, Supabase connected, all 7 tables created
- No UI views built yet — App.jsx is a test connection component
- Next: clean up App.jsx, set up routing, build Jobs view

## Apps Script Reference
The live Apps Script version has all 7 views complete. Use it as the reference for business logic, data relationships, and UX patterns. Key functions to reference:
- rJobsHome() — Jobs view scoreboard + list
- rJobs() — Schedule board
- rBilling() — Billing pipeline
- rMaterials() — Materials tracker
- rCal() — Calendar
- rDaily() — Daily view
- rSchedules() — Crew schedule cards

## Critical Rules
- Always specify VS Code terminal vs Claude Code terminal
- Run terminal commands one at a time, never bundle multi-line commands in outer quotes
- The Apps Script version stays live during entire v2 build — parallel run strategy
- Never enable RLS on tables until auth is properly set up
- One fix/feature at a time, never bundle changes
- Code delivered as plain text in code blocks
