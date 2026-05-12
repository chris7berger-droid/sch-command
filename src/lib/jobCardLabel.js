// Card title + WTC chip helpers used by ScheduledCardList and JobCardList.
// Per Q4 + NEW-G in the planning doc:
//   Single-WTC card title: "<jobNum> - <jobName> - <workTypeName>"
//   Joined card title:     "<jobNum> - <jobName> - N work types"
//   Chip below title:      ["WTC 1", "WTC 2", ...]
//
// Legacy rows (no job_wtcs children) fall back to splitting job.work_type
// on commas, which preserves the pre-refactor display.

// Defensive: some legacy rows arrive with job_name doubled like "X - X"
// (data weirdness from earlier import paths). De-duplicate at display time.
function _dedupeName(name) {
  if (!name) return name
  const parts = String(name).split(/\s+-\s+/)
  const half = parts.length / 2
  if (Number.isInteger(half) && half > 0) {
    const first = parts.slice(0, half).join(' - ')
    const second = parts.slice(half).join(' - ')
    if (first === second) return first
  }
  return name
}

// Some legacy / call_log-driven rows store `job_num` as the full composite
// label (e.g. "10031 - Testing push from SC to SCH C") instead of just "10031".
// When that happens, ${num} - ${name} doubles the name. Detect and strip.
function _cleanNum(num, name) {
  if (!num) return ''
  if (!name) return num
  const parts = String(num).split(/\s+-\s+/)
  if (parts.length > 1 && parts.slice(1).join(' - ').trim() === String(name).trim()) {
    return parts[0]
  }
  return num
}

function _jobLabelPrefix(job) {
  const rawNum = job?.job_num ?? ''
  const name = _dedupeName(job?.job_name ?? '')
  const num = _cleanNum(rawNum, name)
  if (num && name) return `${num} - ${name}`
  return num || name || ''
}

// True if `suffix` is already substring-contained in `prefix` (case-insensitive).
function _alreadyIn(prefix, suffix) {
  if (!suffix) return false
  return String(prefix).toLowerCase().includes(String(suffix).toLowerCase())
}

export function getCardTitle(job, wtcs) {
  const prefix = _jobLabelPrefix(job)
  const list = Array.isArray(wtcs) ? wtcs : []

  if (list.length === 1) {
    const w = list[0]
    const wtype = w?.work_type_name || ''
    if (!wtype || _alreadyIn(prefix, wtype)) return prefix
    return `${prefix} - ${wtype}`
  }

  if (list.length > 1) {
    return `${prefix} - ${list.length} work types`
  }

  // Legacy fallback: split jobs.work_type on commas.
  const legacy = (job?.work_type || '').split(',').map(s => s.trim()).filter(Boolean)
  if (legacy.length === 1) {
    if (_alreadyIn(prefix, legacy[0])) return prefix
    return `${prefix} - ${legacy[0]}`
  }
  if (legacy.length > 1) return `${prefix} - ${legacy.length} work types`
  return prefix
}

export function getWtcChips(wtcs) {
  const list = Array.isArray(wtcs) ? wtcs : []
  if (list.length === 0) return []
  // Order by `position` if available, else preserve incoming order.
  const sorted = [...list].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
  return sorted.map((_, i) => `WTC ${i + 1}`)
}
