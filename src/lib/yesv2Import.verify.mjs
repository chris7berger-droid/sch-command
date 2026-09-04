// Offline verify for the YESv2 import engine — no DB, no auth.
// Run:  node src/lib/yesv2Import.verify.mjs
// Reads the checked-in "YES Schedule v2 - *.csv" sample files at the repo root
// and exercises header validation, row transforms, crew derivation, and the
// smart-assist ranking against a tiny synthetic call_log. Prints a PASS/FAIL
// summary. This is a sanity harness, not a substitute for the in-app rehearsal.

import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'
import {
  validateHeaders, transformJob, transformAssignment, transformBillingLog,
  transformCrewStatus, collapseCrewStatus, deriveCrew, rankCandidates, wallDate, yesNo, money,
} from './yesv2Import.js'

const ROOT = new URL('../../', import.meta.url).pathname
const readCsv = (f) => parse(readFileSync(ROOT + f, 'utf-8'), { columns: true, skip_empty_lines: true, trim: false })

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++ } else { fail++; console.log('  ✗ FAIL:', msg) } }

// ── unit checks on coercers ──
ok(yesNo('Yes') === 'Yes' && yesNo('true') === 'Yes' && yesNo('No') === 'No' && yesNo('') === 'No', 'yesNo mapping')
ok(money('$12,500.50') === 12500.5 && money('') === null, 'money strip')
ok(wallDate('2026-02-23') === '2026-02-23' && wallDate('2/3/2026') === '2026-02-03' && wallDate('') === null, 'wallDate wall-clock (no tz shift)')

// ── Jobs ──
const jobsRaw = readCsv('YES Schedule v2 - Jobs.csv')
const jh = validateHeaders('Jobs', Object.keys(jobsRaw[0] || {}))
ok(jh.ok, `Jobs headers valid (missing: ${jh.missing.join(',')})`)
const jobs = jobsRaw.map(transformJob)
ok(jobs.length === jobsRaw.length, 'every Jobs row transforms')
ok(jobs.every(j => j.deleted === 'No'), 'jobs.deleted = No')
ok(jobs.every(j => ['Yes', 'No'].includes(j.prevailing_wage)), 'prevailing_wage is Yes/No text')
ok(jobs.every(j => j.call_log_id === null), 'call_log_id null pre-match')
ok(!jobs.some(j => j.status === 'Active'), 'no Active status survives (mapped→Ongoing)')
ok(jobs.every(j => j._oldJobId), 'every job carries _oldJobId for remap')
const warns = jobs.filter(j => j._statusWarning)
console.log(`  · status warnings: ${warns.length}${warns.length ? ' → ' + [...new Set(warns.map(w => w._statusWarning))].join('; ') : ''}`)

// ── Assignments ──
const asgRaw = readCsv('YES Schedule v2 - Assignments.csv')
ok(validateHeaders('Assignments', Object.keys(asgRaw[0] || {})).ok, 'Assignments headers valid')
const asg = asgRaw.map(transformAssignment).filter(Boolean)
ok(asg.every(a => a._oldJobId && a.crew_name && a.date), 'assignments complete after skip-filter')

// ── BillingLog ──
const blRaw = readCsv('YES Schedule v2 - BillingLog.csv')
ok(validateHeaders('BillingLog', Object.keys(blRaw[0] || {})).ok, 'BillingLog headers valid')
const bl = blRaw.map(transformBillingLog).filter(Boolean)
ok(bl.every(b => typeof b.invoiced === 'boolean'), 'billing_log.invoiced is boolean')

// ── CrewStatus + crew derivation ──
const csRaw = readCsv('YES Schedule v2 - CrewStatus.csv')
ok(validateHeaders('CrewStatus', Object.keys(csRaw[0] || {})).ok, 'CrewStatus headers valid')
const cs = collapseCrewStatus(csRaw.map(transformCrewStatus).filter(Boolean))
const dupFree = new Set(cs.map(r => r.crew_name + '||' + r.date)).size === cs.length
ok(dupFree, 'crew_status collapsed unique on (crew_name,date)')
const crew = deriveCrew(asgRaw, csRaw)
ok(crew.length > 0 && crew.every(c => c.archived === false), 'crew derived, archived boolean false')
console.log(`  · derived crew (${crew.length}): ${crew.map(c => c.name).slice(0, 8).join(', ')}${crew.length > 8 ? '…' : ''}`)

// ── header rejection ──
const bad = validateHeaders('Jobs', ['JobID', 'JobNum'])
ok(!bad.ok && bad.missing.length > 0, 'malformed Jobs upload rejected')

// ── smart-assist ranking on a synthetic call_log ──
const fakeCallLog = [
  { id: 1, display_job_number: '6507', job_number: 6507, co_number: null, job_name: 'Contract Flooring — Warehouse', customer_name: 'Contract Flooring' },
  { id: 2, display_job_number: '6507 CO1', job_number: 6507, co_number: 1, job_name: 'Contract Flooring — CO1', customer_name: 'Contract Flooring' },
  { id: 3, display_job_number: '9001', job_number: 9001, co_number: null, job_name: 'Kalb - Officers Memorial - Weatherproofing', customer_name: 'KalB Construction' },
  { id: 4, display_job_number: '1234', job_number: 1234, co_number: null, job_name: 'Unrelated Job', customer_name: 'Someone Else' },
]
const kalb = rankCandidates({ job_num: 'Kalb', job_name: 'Kalb' }, fakeCallLog)
ok(kalb[0]?.candidate.id === 3, 'Kalb ranks the Kalb record first by name')
const num = rankCandidates({ job_num: '6507', job_name: 'Contract Flooring' }, fakeCallLog)
ok(num[0]?.candidate.job_number === 6507, '6507 ranks a 6507 record first by number')
ok(num.every(x => x.tier), 'every candidate has a confidence tier')

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`)
console.log(`Sample-file rows: Jobs ${jobs.length}, Assignments ${asg.length}, BillingLog ${bl.length}, CrewStatus(raw ${csRaw.length}→collapsed ${cs.length}), Crew ${crew.length}`)
process.exit(fail === 0 ? 0 : 1)
