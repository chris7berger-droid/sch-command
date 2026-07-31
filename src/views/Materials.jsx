import { useEffect, useState, useCallback } from 'react'
import { loadJobs } from '../lib/queries'
import { useUser } from '../lib/user'
import LogisticsMaterials from '../components/LogisticsMaterials'

// DMS-1 Phase 3 Step 3 — the standalone /materials page is REPOINTED off the dead
// `materials` table. Disposition: the legacy spreadsheet "Upload SOW" importer is
// retired here (its insert/clear/edit wrote the dead table); materials now flow
// from the Field SOW → job_material_lines. This page is now a per-job browser that
// renders the SHARED LogisticsMaterials view — the same editor as each job's
// Logistics tab (no drift). Phase 5 deletes the page + the `materials` table.

function isPW(j) { return j.prevailing_wage === 'Yes' || j.prevailing_wage === true }

function gTagClass(wt) {
  if (!wt) return ''
  const lower = wt.toLowerCase()
  if (lower.includes('epoxy')) return 'mat-tag-epoxy'
  if (lower.includes('caulk')) return 'mat-tag-caulk'
  if (lower.includes('demo')) return 'mat-tag-demo'
  if (lower.includes('polish')) return 'mat-tag-polish'
  return 'mat-tag-other'
}

export default function Materials() {
  const user = useUser()
  const changedBy = user?.name || 'unknown'
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [expandedJobs, setExpandedJobs] = useState({})

  const fetchData = useCallback(async () => {
    const res = await loadJobs()
    if (res.error) { setError(res.error.message); setLoading(false); return }
    setJobs((res.data || [])
      .filter(j => ['Ongoing', 'Scheduled', 'In Progress', 'On Hold'].includes(j.status))
      .sort((a, b) => (a.job_num || '').localeCompare(b.job_num || '')))
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleExpand = (jobId) => setExpandedJobs(prev => ({ ...prev, [jobId]: !prev[jobId] }))

  if (loading) return <div className="loading">Loading materials...</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  const searchLower = search.toLowerCase()
  const filtered = search
    ? jobs.filter(j =>
        (j.job_name || '').toLowerCase().includes(searchLower) ||
        (j.job_num || '').toString().toLowerCase().includes(searchLower) ||
        (j.work_type || '').toLowerCase().includes(searchLower))
    : jobs

  return (
    <div className="mat-wrap">
      <div className="mat-search-bar">
        <input
          type="text"
          className="mat-search-input"
          placeholder="Search jobs by name, number, or work type..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="mat-search-clear" onClick={() => setSearch('')}>&times;</button>}
      </div>

      <div className="mat-header">Logistics by Job ({filtered.length} active)</div>
      <div style={{ fontSize: 12, color: 'var(--sand-dark)', margin: '0 0 10px', lineHeight: 1.4 }}>
        Materials now come from the Field SOW. Open a job to view and edit its Needed-vs-Ordered logistics.
      </div>

      {filtered.length === 0 && <div className="mat-empty">No matching jobs found.</div>}

      {filtered.map(job => (
        <JobMaterialCard
          key={job.job_id}
          job={job}
          changedBy={changedBy}
          expanded={!!expandedJobs[job.job_id]}
          onToggle={() => toggleExpand(job.job_id)}
        />
      ))}
    </div>
  )
}

function JobMaterialCard({ job, changedBy, expanded, onToggle }) {
  const workTypes = (job.work_type || '').split(',').map(s => s.trim()).filter(Boolean)
  return (
    <div className={`mat-card${expanded ? ' mat-card-expanded' : ''}`}>
      <div className="mat-card-header" onClick={onToggle}>
        <div className="mat-card-title-row">
          <div className="mat-card-title">
            <span className="mat-job-num">{job.job_num}</span>
            <span className="mat-job-sep"> - </span>
            <span className="mat-job-name">{job.job_name}</span>
            {isPW(job) && <span className="mat-pw-badge">PW</span>}
          </div>
          <div className="mat-card-expand-icon">{expanded ? '▲' : '▼'}</div>
        </div>
        <div className="mat-card-meta">
          <div className="mat-tags">
            {workTypes.map(wt => <span key={wt} className={`mat-tag ${gTagClass(wt)}`}>{wt}</span>)}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mat-table-wrap">
          <LogisticsMaterials job={job} changedBy={changedBy} />
        </div>
      )}
    </div>
  )
}
