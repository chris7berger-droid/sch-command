// Single source of truth for status normalization across sch-command.
//
// Legacy 'Parked'-status rows (written by the old sales-command 1-click
// handler) are mapped to 'Scheduled' here so they surface under the new
// Scheduled tile. This is a read-time normalization — the underlying
// jobs.status column is not migrated. See plan §3.8 + §7.

export function getJobStatus(j) {
  if (!j || !j.status) return 'Ongoing'
  const s = j.status.toLowerCase().trim()
  if (s === 'parked') return 'Scheduled'
  if (s === 'scheduled') return 'Scheduled'
  if (s === 'in progress') return 'In Progress'
  if (s === 'on hold' || s === 'hold') return 'On Hold'
  if (s === 'complete' || s === 'completed' || s === 'done') return 'Complete'
  return 'Ongoing'
}

// Values the user can write back via the status select. 'Ongoing' is
// legacy-readable but not assignable from the dropdown going forward.
export const STATUS_OPTIONS_PICKER = [
  'Scheduled',
  'In Progress',
  'On Hold',
  'Complete',
]

// Maps a normalized status to the CSS class used by .jh-status-badge.
export function getStatusBadgeClass(status) {
  if (status === 'On Hold') return 'oh'
  if (status === 'Complete') return 'cp'
  return 'og'  // Scheduled, In Progress, Ongoing
}

export const STATUS_BADGE_CLASS = {
  Scheduled: 'og',
  'In Progress': 'og',
  Ongoing: 'og',
  'On Hold': 'oh',
  Complete: 'cp',
}
