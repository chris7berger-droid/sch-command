import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const supabase = createClient(
  'https://tzwhgspgpyzhhwwjzugb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6d2hnc3BncHl6aGh3d2p6dWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzE1MzEsImV4cCI6MjA4OTYwNzUzMX0.IH8BYfiAplZfhZ9TkFkFFYFd0QjQzLhvDgsSi1sm8qc'
)

function readCSV(filename) {
  const text = readFileSync(filename, 'utf-8')
  return parse(text, { columns: true, skip_empty_lines: true, trim: true })
}

const DIR = '/Users/chrisberger/Desktop/sch-command/'

async function clearTable(name) {
  // Use a broad filter to delete all rows
  const { error } = await supabase.from(name).delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) {
    // Some tables use integer ids
    const { error: e2 } = await supabase.from(name).delete().gte('id', 0)
    if (e2) console.log(`  Warning clearing ${name}:`, e2.message)
  }
}

async function migrateJobs() {
  const rows = readCSV(DIR + 'YES Schedule v2 - Jobs.csv')
  console.log(`Jobs: ${rows.length} rows`)
  await clearTable('jobs')

  const jobs = rows.map(r => ({
    job_id: r.JobID,
    job_num: r.JobNum,
    job_name: r.JobName,
    amount: r.Amount || null,
    work_type: r.WorkType || null,
    crew_needed: parseInt(r.CrewNeeded) || null,
    lead: r.Lead || null,
    vehicle: r.Vehicle || null,
    equipment: r.Equipment && r.Equipment !== 'n/a' ? r.Equipment : null,
    power_source: r.PowerSource && r.PowerSource !== 'n/a' ? r.PowerSource : null,
    sow: r.SOW || null,
    status: r.Status === 'Active' ? 'Ongoing' : (r.Status || 'Ongoing'),
    start_date: r.StartDate || null,
    end_date: r.EndDate || null,
    color: r.Color || null,
    prevailing_wage: (r.PrevailingWage === 'Yes' || r.PrevailingWage === 'true') ? 'true' : 'false',
    partial_billing: r.PartialBilling || 'No',
    partial_bill_date: r.PartialBillDate || null,
    partial_percent: r.PartialPercent ? parseFloat(r.PartialPercent) : null,
    billed_to_date: r.BilledToDate ? parseFloat(r.BilledToDate) : 0,
    billing_paused: r.BillingPaused || 'No',
    billing_notes: r.BillingNotes || null,
    notes: r['Notes '] || r.Notes || null,
    deferred_time: r.DeferredTime || null,
    deferred_days: r.DeferredDays || null,
    no_bill: r.NoBill || 'No',
    no_bill_reason: r.NoBillReason || null,
    deleted: 'No',
  }))

  for (let i = 0; i < jobs.length; i += 50) {
    const batch = jobs.slice(i, i + 50)
    const { error } = await supabase.from('jobs').insert(batch)
    if (error) { console.log(`  Jobs batch ${i} error:`, error.message); console.log('  Sample:', JSON.stringify(batch[0], null, 2)); return }
  }
  console.log('  Jobs inserted:', jobs.length)
}

async function migrateAssignments() {
  const rows = readCSV(DIR + 'YES Schedule v2 - Assignments.csv')
  console.log(`Assignments: ${rows.length} rows`)
  await clearTable('assignments')

  const assignments = rows.map(r => ({
    job_id: r.JobID,
    crew_name: r.CrewName,
    date: r.Date,
  }))

  for (let i = 0; i < assignments.length; i += 100) {
    const batch = assignments.slice(i, i + 100)
    const { error } = await supabase.from('assignments').insert(batch)
    if (error) { console.log(`  Assignments batch ${i} error:`, error.message); console.log('  Sample:', JSON.stringify(batch[0])); return }
  }
  console.log('  Assignments inserted:', assignments.length)
}

async function migrateCrew() {
  const aRows = readCSV(DIR + 'YES Schedule v2 - Assignments.csv')
  const sRows = readCSV(DIR + 'YES Schedule v2 - CrewStatus.csv')
  await clearTable('crew')

  const names = new Set()
  aRows.forEach(r => { if (r.CrewName) names.add(r.CrewName) })
  sRows.forEach(r => { if (r.Name) names.add(r.Name) })

  const crew = [...names].map(name => ({ name, team: null, phone: null, archived: false }))
  console.log(`Crew: ${crew.length} members (derived)`)

  const { error } = await supabase.from('crew').insert(crew)
  if (error) console.log('  Crew error:', error.message)
  else console.log('  Crew inserted:', crew.length)
}

async function migrateCrewStatus() {
  const rows = readCSV(DIR + 'YES Schedule v2 - CrewStatus.csv')
  console.log(`CrewStatus: ${rows.length} rows`)
  await clearTable('crew_status')

  const statuses = rows.map(r => ({
    crew_name: r.Name,
    date: r.Date,
    status: r.Status,
  }))

  const { error } = await supabase.from('crew_status').insert(statuses)
  if (error) console.log('  CrewStatus error:', error.message)
  else console.log('  CrewStatus inserted:', statuses.length)
}

async function migrateWorkTypes() {
  const rows = readCSV(DIR + 'YES Schedule v2 - WorkTypes.csv')
  console.log(`WorkTypes: ${rows.length} rows`)
  await clearTable('work_types')

  const types = rows.map(r => ({ name: r.Type }))
  const { error } = await supabase.from('work_types').insert(types)
  if (error) console.log('  WorkTypes error:', error.message)
  else console.log('  WorkTypes inserted:', types.length)
}

async function migrateMaterials() {
  const rows = readCSV(DIR + 'YES Schedule v2 - Materials.csv')
  console.log(`Materials: ${rows.length} rows`)
  await clearTable('materials')

  const materials = rows.map((r, i) => ({
    job_id: r['This '] || r.JobID || r[Object.keys(r)[0]],
    ordinal: i,
    name: r.Material,
    status: r.MatStatus || 'Not Ordered',
    arrival_date: r.ArrivalDate || null,
    notes: r.Notes || null,
  }))

  const { error } = await supabase.from('materials').insert(materials)
  if (error) { console.log('  Materials error:', error.message); console.log('  Sample:', JSON.stringify(materials[0])) }
  else console.log('  Materials inserted:', materials.length)
}

async function migrateBillingLog() {
  const rows = readCSV(DIR + 'YES Schedule v2 - BillingLog.csv')
  console.log(`BillingLog: ${rows.length} rows`)
  await clearTable('billing_log')

  const logs = rows.map(r => ({
    job_id: r.JobID,
    date: r.Date,
    percent: parseFloat(r.Percent) || 0,
    cumulative_percent: parseFloat(r.CumulativePercent) || 0,
    type: r.Type || null,
    notes: r.Notes || null,
    invoiced: r.Invoiced === 'Yes',
    invoiced_date: r.InvoicedDate || null,
  }))

  const { error } = await supabase.from('billing_log').insert(logs)
  if (error) { console.log('  BillingLog error:', error.message); console.log('  Sample:', JSON.stringify(logs[0])) }
  else console.log('  BillingLog inserted:', logs.length)
}

console.log('Starting migration...\n')
await migrateJobs()
await migrateAssignments()
await migrateCrew()
await migrateCrewStatus()
await migrateWorkTypes()
await migrateMaterials()
await migrateBillingLog()
console.log('\nDone!')
