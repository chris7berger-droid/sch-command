// At-a-glance mobilizations popover. A mobilization is one trip to site
// (Mob 1, Mob 2…). Read-only view of the job's mobs, derived from the
// mobilization_seq tags on its SOW days and hydrated with labels/dates from
// the originating proposal. Authoring lives on the Sales side, not here.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ISO "2026-07-28" → "Jul 28" (local-parse, no TZ shift). null on empty/invalid.
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

function rangeLabel(mob) {
  const a = fmtShort(mob.start_date)
  const b = fmtShort(mob.end_date)
  if (!a && !b) return 'Dates TBD'
  const base = a && b && mob.start_date === mob.end_date ? a : `${a || 'TBD'} – ${b || 'TBD'}`
  return mob.datesPlanned ? `${base} (planned)` : base
}

function metaLabel(mob) {
  const parts = []
  if (mob.workTypes?.length) parts.push(mob.workTypes.join(', '))
  parts.push(`${mob.dayCount} day${mob.dayCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export default function MobsModal({ job, mobs = [], onClose }) {
  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 440, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Mobilizations — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {mobs.length === 0 ? (
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No mobilizations set for this job yet. Mobilizations (trips to site) are planned on the Sales proposal.
          </div>
        ) : (
          <div className="mobs-list">
            {mobs.map(mob => (
              <div key={mob.seq} className="mobs-row">
                <div className="mobs-seq">Mob {mob.seq}</div>
                <div className="mobs-body">
                  <div className="mobs-label">{mob.label}</div>
                  <div className="mobs-meta">{metaLabel(mob)}</div>
                  <div className="mobs-dates">{rangeLabel(mob)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
