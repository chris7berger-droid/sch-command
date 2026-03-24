import { supabase } from './supabase'

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function fmtD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function fmtWk(monday) {
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const end = new Date(monday)
  end.setDate(end.getDate() + 5)
  return ms[monday.getMonth()] + ' ' + monday.getDate() + ' - ' + ms[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear()
}

function wkDates(monday) {
  const r = []
  for (let i = 0; i < 6; i++) {
    const dt = new Date(monday)
    dt.setDate(dt.getDate() + i)
    r.push(fmtD(dt))
  }
  return r
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function isPW(j) {
  return j.prevailing_wage === 'Yes' || j.prevailing_wage === 'true' || j.prevailing_wage === true
}

function printWin(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write('<!DOCTYPE html><html><head><title>' + title + '</title><style>')
  w.document.write('body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px;} table{width:100%;border-collapse:collapse;margin-top:12px;} th{background:#1c1814;color:#fff;padding:7px 10px;font-size:11px;text-align:left;} td{padding:6px 10px;border-bottom:1px solid #ddd;} tr:nth-child(even){background:#f7f5f2;} h2{font-size:16px;margin:0 0 4px;} .sub{font-size:11px;color:#666;margin-bottom:16px;} .chip{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;margin-right:3px;background:#eee;}')
  w.document.write('@media print{button{display:none}}')
  w.document.write('</style></head><body>')
  w.document.write('<button onclick="window.print()" style="margin-bottom:16px;padding:8px 20px;background:#1c1814;color:#fff;border:none;border-radius:4px;font-size:13px">Print / Save as PDF</button>')
  w.document.write(bodyHtml)
  w.document.write('</body></html>')
  w.document.close()
}

export async function printWeekSchedule() {
  const monday = getMonday(new Date())
  const dates = wkDates(monday)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weStr = dates[5]
  const wsStr = dates[0]

  const [jobRes, asgnRes] = await Promise.all([
    supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
    supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
  ])
  const jobs = jobRes.data || []
  const assignments = asgnRes.data || []

  const wkJobs = jobs.filter(j => {
    if (j.status !== 'Ongoing' && j.status !== 'On Hold') return false
    const js = j.start_date ? String(j.start_date).split('T')[0] : ''
    const je = j.end_date ? String(j.end_date).split('T')[0] : ''
    if (!js && !je) return true
    const start = js || '0000-01-01'
    const end = je || '9999-12-31'
    return start <= weStr && end >= wsStr
  })

  let b = '<h2>Week Schedule</h2><div class="sub">' + fmtWk(monday) + '</div>'
  b += '<table><thead><tr><th>Job</th><th>Type</th><th>PW</th><th>Needed</th><th>Crew</th><th>Vehicle</th><th>Equipment</th><th>Power</th></tr></thead><tbody>'
  for (const j of wkJobs) {
    const crewNames = {}
    for (const a of assignments) {
      if (String(a.job_id) === String(j.job_id)) crewNames[a.crew_name] = true
    }
    const names = Object.keys(crewNames)
    b += '<tr><td><b>' + j.job_num + '</b> - ' + j.job_name + '</td><td>' + (j.work_type || '') + '</td><td>' + (isPW(j) ? 'YES' : '') + '</td><td>' + (j.crew_needed || '') + '</td><td>' + names.map(flipName).join(', ') + '</td><td>' + (j.vehicle || '') + '</td><td>' + (j.equipment || '') + '</td><td>' + (j.power_source || '') + '</td></tr>'
  }
  b += '</tbody></table>'
  printWin('Week Schedule - ' + fmtWk(monday), b)
}

export async function printJobList() {
  const { data: jobs } = await supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No')
  if (!jobs) return

  let b = '<h2>Job List</h2><div class="sub">All active jobs</div>'
  b += '<table><thead><tr><th>Job #</th><th>Name</th><th>Status</th><th>Type</th><th>PW</th><th>Start</th><th>End</th><th>Amount</th></tr></thead><tbody>'
  for (const j of jobs) {
    b += '<tr><td>' + (j.job_num || '') + '</td><td>' + (j.job_name || '') + '</td><td>' + (j.status || '') + '</td><td>' + (j.work_type || '') + '</td><td>' + (isPW(j) ? 'YES' : '') + '</td><td>' + (j.start_date || '') + '</td><td>' + (j.end_date || '') + '</td><td>' + (j.amount || '') + '</td></tr>'
  }
  b += '</tbody></table>'
  printWin('Job List', b)
}

export async function printBillingReport() {
  const monday = getMonday(new Date())
  const [jobRes, blRes] = await Promise.all([
    supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
    supabase.from('billing_log').select('*'),
  ])
  const jobs = jobRes.data || []
  const billingLog = blRes.data || []

  function getBilled(jid) {
    let t = 0
    for (const l of billingLog) {
      if (String(l.job_id) === String(jid)) t += parseFloat(l.percent) || 0
    }
    return Math.min(t, 100)
  }

  let b = '<h2>Billing Report</h2><div class="sub">' + fmtWk(monday) + '</div>'
  b += '<table><thead><tr><th>Job</th><th>Amount</th><th>Status</th><th>Billed %</th><th>PW</th><th>Billing Type</th></tr></thead><tbody>'
  for (const j of jobs) {
    if (j.status === 'Complete' || j.no_bill === 'Yes') continue
    const billed = getBilled(j.job_id)
    const type = j.partial_billing === 'Yes' ? 'Partial' : (j.end_date ? 'On Complete' : 'N/A')
    b += '<tr><td>' + j.job_num + ' - ' + j.job_name + '</td><td>' + (j.amount || '') + '</td><td>' + (j.status || '') + '</td><td>' + Math.round(billed) + '%</td><td>' + (isPW(j) ? 'YES' : '') + '</td><td>' + type + '</td></tr>'
  }
  b += '</tbody></table>'
  printWin('Billing Report', b)
}

export async function printMaterialsList() {
  const [jobRes, matRes] = await Promise.all([
    supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
    supabase.from('materials').select('*'),
  ])
  const jobs = jobRes.data || []
  const materials = matRes.data || []

  let b = '<h2>Materials List</h2><div class="sub">All materials by job</div>'
  b += '<table><thead><tr><th>Job</th><th>Material</th><th>Status</th><th>Arrival</th><th>Notes</th></tr></thead><tbody>'
  for (const m of materials) {
    const j = jobs.find(jj => String(jj.job_id) === String(m.job_id))
    b += '<tr><td>' + (j ? j.job_num + ' - ' + j.job_name : m.job_id) + '</td><td>' + (m.name || '') + '</td><td>' + (m.status || '') + '</td><td>' + (m.arrival_date || '') + '</td><td>' + (m.notes || '') + '</td></tr>'
  }
  b += '</tbody></table>'
  printWin('Materials List', b)
}

export async function printDailyStatus() {
  const monday = getMonday(new Date())
  const dates = wkDates(monday)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const wsStr = dates[0]
  const weStr = dates[5]

  const [crewRes, asgnRes, csRes, jobRes] = await Promise.all([
    supabase.from('crew').select('*'),
    supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
    supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
    supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
  ])
  const crew = (crewRes.data || []).filter(c => c.archived !== 'Yes')
  const assignments = asgnRes.data || []
  const csMap = {}
  for (const c of (csRes.data || [])) {
    csMap[c.crew_name + '|' + c.date] = c.status
  }
  const jobs = jobRes.data || []

  let b = '<h2>Daily Crew Status</h2><div class="sub">' + fmtWk(monday) + '</div>'
  b += '<table><thead><tr><th>Crew</th>'
  for (let i = 0; i < 6; i++) b += '<th>' + days[i] + ' ' + dates[i].split('-')[1] + '/' + dates[i].split('-')[2] + '</th>'
  b += '</tr></thead><tbody>'
  for (const c of crew) {
    b += '<tr><td>' + flipName(c.name) + '</td>'
    for (let di = 0; di < 6; di++) {
      const st = csMap[c.name + '|' + dates[di]] || 'available'
      let assigned = null
      for (const a of assignments) {
        if (a.crew_name === c.name && a.date === dates[di]) {
          assigned = jobs.find(j => String(j.job_id) === String(a.job_id))
          break
        }
      }
      const cell = st !== 'available'
        ? '<span style="color:#c62828;font-weight:700">' + st + '</span>'
        : assigned ? assigned.job_num : '<span style="color:#999">\u2014</span>'
      b += '<td>' + cell + '</td>'
    }
    b += '</tr>'
  }
  b += '</tbody></table>'
  printWin('Daily Crew Status - ' + fmtWk(monday), b)
}
