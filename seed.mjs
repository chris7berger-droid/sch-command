import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://tzwhgspgpyzhhwwjzugb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6d2hnc3BncHl6aGh3d2p6dWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzE1MzEsImV4cCI6MjA4OTYwNzUzMX0.IH8BYfiAplZfhZ9TkFkFFYFd0QjQzLhvDgsSi1sm8qc'
)

const jobs = [
  {
    job_id: 1,
    job_num: '2026-041',
    job_name: 'Mercy Hospital — Lobby Epoxy',
    start_date: '2026-03-10',
    end_date: '2026-04-04',
    status: 'Ongoing',
    crew_needed: 3,
    work_type: 'Epoxy',
    lead: 'Troy',
    vehicle: 'Van 2',
    notes: 'Night work only — hospital occupied during day',
    amount: 34500,
    prevailing_wage: true,
  },
  {
    job_id: 2,
    job_num: '2026-038',
    job_name: 'Riverside Commons — Garage Caulking',
    start_date: '2026-02-24',
    end_date: '2026-03-28',
    status: 'Ongoing',
    crew_needed: 2,
    work_type: 'Caulking',
    lead: 'Jonah',
    vehicle: 'Truck 1',
    notes: 'Levels P1-P3, expansion joints',
    amount: 18200,
    prevailing_wage: false,
  },
  {
    job_id: 3,
    job_num: '2026-035',
    job_name: 'District 204 Admin Bldg — Demo & Prep',
    start_date: '2026-03-03',
    end_date: '2026-03-21',
    status: 'On Hold',
    crew_needed: 4,
    work_type: 'Demo',
    lead: 'Troy',
    vehicle: 'Van 1',
    notes: 'Waiting on asbestos abatement clearance from GC',
    amount: 22000,
    prevailing_wage: true,
  },
  {
    job_id: 4,
    job_num: '2026-029',
    job_name: 'Lincoln Park Condos — Unit Floors',
    start_date: '2026-01-13',
    end_date: '2026-02-28',
    status: 'Complete',
    crew_needed: 3,
    work_type: 'Epoxy',
    lead: 'Jonah',
    vehicle: 'Van 2',
    notes: 'Punch list done, final walkthrough passed',
    amount: 41000,
    prevailing_wage: false,
  },
  {
    job_id: 5,
    job_num: '2026-042',
    job_name: 'Oak Brook Office Tower — Loading Dock Coating',
    start_date: '2026-03-17',
    end_date: '2026-04-11',
    status: 'Ongoing',
    crew_needed: 2,
    work_type: 'Epoxy',
    lead: 'Troy',
    vehicle: 'Truck 1',
    equipment: 'Grinder, diamond tooling',
    power_source: '480V on-site',
    notes: 'Weekend access only',
    amount: 27500,
    prevailing_wage: false,
  },
]

const { data, error } = await supabase.from('jobs').insert(jobs).select()

if (error) {
  console.error('Seed failed:', error.message)
  process.exit(1)
} else {
  console.log(`Seeded ${data.length} jobs:`)
  data.forEach(j => console.log(`  ${j.job_num} — ${j.job_name} [${j.status}]`))
}
