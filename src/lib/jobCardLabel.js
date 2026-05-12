// Card title + WTC chip helpers used by ScheduledCardList and JobCardList.
// Per Q4 + NEW-G in the planning doc:
//   Single-WTC card title: "<jobNum> - <jobName> - <workTypeName>"
//   Joined card title:     "<jobNum> - <jobName> - N work types"
//   Chip below title:      ["WTC 1", "WTC 2", ...]
//
// Legacy rows (no job_wtcs children) fall back to splitting job.work_type
// on commas, which preserves the pre-refactor display.

function _jobLabelPrefix(job) {
  const num = job?.job_num ?? ''
  const name = job?.job_name ?? ''
  if (num && name) return `${num} - ${name}`
  return num || name || ''
}

export function getCardTitle(job, wtcs) {
  const prefix = _jobLabelPrefix(job)
  const list = Array.isArray(wtcs) ? wtcs : []

  if (list.length === 1) {
    const w = list[0]
    const wtype = w?.work_type_name || ''
    return wtype ? `${prefix} - ${wtype}` : prefix
  }

  if (list.length > 1) {
    return `${prefix} - ${list.length} work types`
  }

  // Legacy fallback: split jobs.work_type on commas.
  const legacy = (job?.work_type || '').split(',').map(s => s.trim()).filter(Boolean)
  if (legacy.length === 1) return `${prefix} - ${legacy[0]}`
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
