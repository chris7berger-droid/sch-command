import { useNavigate } from 'react-router-dom'
import { effectiveStart, getMonday, fmtD } from '../lib/queries'

// The three middle panels (§8 composition #3): Needs Attention (light), Next Up
// (dark feature card), At a Glance (light). All numbers come from
// computeHomeDashboard (§11) — no hardcoded values.

export function NeedsAttention({ data }) {
  const navigate = useNavigate()
  const rows = [
    { key: 'crews', color: 'red', count: data?.needCrews ?? 0, label: 'Jobs need crews', sub: 'Short on crew this week', icon: '👷' },
    { key: 'conflicts', color: 'orange', count: data?.conflicts ?? 0, label: 'Schedule conflicts', sub: 'Employees double-booked', icon: '⚠️' },
    { key: 'notready', color: 'purple', count: data?.notReady ?? 0, label: 'Jobs not ready', sub: 'Starting within 10 days', icon: '📋' },
  ]
  return (
    <section className="hp-card hp-needs">
      <div className="hp-label">Needs Attention</div>
      <div className="hp-alert-list">
        {rows.map(r => (
          <button key={r.key} className="hp-alert-row" onClick={() => navigate('/jobs?tab=all')}>
            <span className={`hp-alert-badge hp-badge-${r.color}`}>{r.count}</span>
            <span className="hp-alert-text">
              <span className="hp-alert-title">{r.label}</span>
              <span className="hp-alert-sub">{r.sub}</span>
            </span>
            <span className="hp-chevron">›</span>
          </button>
        ))}
      </div>
      <button className="hp-footer-link" onClick={() => navigate('/jobs?tab=all')}>View All Alerts →</button>
    </section>
  )
}

export function NextUp({ nextUp }) {
  const navigate = useNavigate()
  const job = nextUp?.job
  const goCrewSchedule = () => {
    if (!job) return
    const s = effectiveStart(job)
    if (s) {
      navigate(`/schedule?job=${job.job_id}&week=${fmtD(getMonday(new Date(s + 'T00:00:00')))}`)
    } else {
      navigate(`/schedule?job=${job.job_id}`)
    }
  }

  if (!job) {
    return (
      <section className="hp-card hp-nextup hp-nextup-empty">
        <div className="hp-label hp-label-teal">Next Up</div>
        <div className="hp-nextup-none">No upcoming jobs need scheduling attention.</div>
      </section>
    )
  }

  const loc = [job.jobsite_city, job.jobsite_state].filter(Boolean).join(', ') || '—'
  const crewSize = nextUp.crewSize
  const crewNeeded = nextUp.crewNeeded
  // A 0-crew-needed job is satisfied at 0/0 — don't flag it "not assigned".
  const noCrewNeeded = crewNeeded === 0
  const crewOk = crewSize >= crewNeeded
  const workType = job._wtcs?.[0]?.work_type_name || job.work_type || '—'

  return (
    <section className="hp-card hp-nextup">
      <div className="hp-nextup-head">
        <div className="hp-label hp-label-teal">Next Up</div>
        <span className="hp-star">★</span>
      </div>
      <div className="hp-nextup-title">{job.job_name || job.job_num || 'Job'}</div>
      <div className="hp-nextup-grid">
        <div className="hp-nu-field"><span className="hp-nu-k">Job #{job.job_num || '—'}</span></div>
        <div className="hp-nu-field"><span className="hp-nu-lbl">Work Type</span><span className="hp-nu-val">{workType}</span></div>
        <div className="hp-nu-field"><span className="hp-nu-lbl">Customer</span><span className="hp-nu-val">{job.customer_name || '—'}</span></div>
        <div className="hp-nu-field"><span className="hp-nu-lbl">Location</span><span className="hp-nu-val">{loc}</span></div>
      </div>
      <div className={`hp-nu-crew ${crewOk ? 'ok' : 'bad'}`}>
        {noCrewNeeded && crewSize === 0 ? '✓ No crew needed'
          : crewOk ? `✓ ${crewSize}/${crewNeeded} crew assigned`
          : '⚠ Crew not assigned'}
      </div>
      <div className="hp-nu-actions">
        <button className="hp-btn hp-btn-fill" onClick={goCrewSchedule}>Build Schedule →</button>
        <button className="hp-btn hp-btn-outline" onClick={() => navigate(`/jobs/${job.job_id}?mode=management`)}>View Job</button>
      </div>
    </section>
  )
}

export function AtAGlance({ data }) {
  const navigate = useNavigate()
  const completion = data?.completionPct == null ? '—' : `${data.completionPct}%`
  const stats = [
    { key: 'sched', value: data?.jobsScheduled ?? 0, label: 'Jobs scheduled', sub: 'This week', color: 'teal', icon: '📅' },
    { key: 'asgn', value: data?.crewAssignmentsCount ?? 0, label: 'Crew assignments', sub: 'This week', color: 'orange', icon: '👷' },
    { key: 'compl', value: completion, label: 'Schedule completion', sub: 'This week', color: 'purple', icon: '✓' },
  ]
  return (
    <section className="hp-card hp-glance">
      <div className="hp-label">At a Glance</div>
      <div className="hp-glance-list">
        {stats.map(s => (
          <div key={s.key} className="hp-glance-row">
            <span className={`hp-glance-icon hp-badge-${s.color}`}>{s.icon}</span>
            <span className={`hp-glance-value hp-val-${s.color}`}>{s.value}</span>
            <span className="hp-glance-text">
              <span className="hp-glance-title">{s.label}</span>
              <span className="hp-glance-sub">{s.sub}</span>
            </span>
          </div>
        ))}
      </div>
      <button className="hp-footer-link" onClick={() => navigate('/billing/forecast')}>View Analytics →</button>
    </section>
  )
}
