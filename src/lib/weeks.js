// Shared Monday-anchored week helpers.
//
// Lifted from the canonical 3-way-identical copy in exports.js / Schedule.jsx /
// Daily.jsx (plan §4.3/§7, D5). The billing worklist + 90-day forecast import
// getMonday/fmtWk from HERE rather than from Billing.jsx, which is being retired.
//
// fmtWk is the string-tolerant form from Billing.jsx (accepts a Date OR a
// 'YYYY-MM-DD' string), so reconciling Billing.jsx's callers to this shared
// version does not regress them.

export function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

export function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Mon → Mon+5 (Sat) range label, e.g. "Jun 16 – Jun 21, 2026".
// Accepts a Date or a 'YYYY-MM-DD' string (string-arg handling preserved from Billing.jsx).
export function fmtWk(monday) {
  const mon = monday instanceof Date ? monday : new Date(monday + 'T00:00:00')
  const sat = new Date(mon)
  sat.setDate(mon.getDate() + 5)
  const mStr = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`
  const sStr = `${MONTHS[sat.getMonth()]} ${sat.getDate()}`
  return `${mStr} – ${sStr}, ${sat.getFullYear()}`
}
