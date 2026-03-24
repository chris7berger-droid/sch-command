import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

/* ── helpers ── */

function getJobStatus(j) {
  if (j.deleted === 'Yes') return 'Deleted'
  return j.status || 'Unknown'
}

function isPW(j) {
  return j.prevailing_wage === 'Yes' || j.prevailing_wage === true
}

function flipName(name) {
  if (!name) return ''
  const parts = name.split(', ')
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name
}

function gTagClass(wt) {
  if (!wt) return ''
  const lower = wt.toLowerCase()
  if (lower.includes('epoxy')) return 'mat-tag-epoxy'
  if (lower.includes('caulk')) return 'mat-tag-caulk'
  if (lower.includes('demo')) return 'mat-tag-demo'
  if (lower.includes('polish')) return 'mat-tag-polish'
  return 'mat-tag-other'
}

const STATUS_OPTIONS = ['Not Ordered', 'Ordered', 'In Stock', 'Delayed']

function statusColor(status) {
  switch (status) {
    case 'Ordered': return '#2980b9'
    case 'In Stock': return '#27ae60'
    case 'Delayed': return '#e67e22'
    case 'Not Ordered': return '#c0392b'
    default: return '#8a7f73'
  }
}

/* ── SOW parser ── */

function parseSOW(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  const materials = []
  let currentPhase = ''
  let currentTask = ''
  let inMaterialBlock = false
  let ordinal = 1

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    const col0 = String(row[0] || '').trim()
    const col1 = String(row[1] || '').trim()
    const col2 = String(row[2] || '').trim()

    // Phase detection: lines starting with "Day N"
    if (/^Day\s+\d+/i.test(col0)) {
      currentPhase = col0
      currentTask = col2 || col1 || ''
      inMaterialBlock = false
      continue
    }

    // Material header row: col0="Material", col1 contains "Kit"
    if (col0.toLowerCase() === 'material' && col1.toLowerCase().includes('kit')) {
      inMaterialBlock = true
      continue
    }

    // End material block: col0="Crew Count" or starts with "WTC"
    if (col0.toLowerCase() === 'crew count' || col0.toUpperCase().startsWith('WTC')) {
      inMaterialBlock = false
      continue
    }

    // Material row
    if (inMaterialBlock && col0) {
      materials.push({
        ordinal: ordinal++,
        phase: currentPhase,
        task: currentTask,
        name: col0,
        kit_size: col2 || String(row[2] || ''),
        qty_ordered: row[3] ? Number(row[3]) || null : null,
        mils: row[4] ? String(row[4]) : '',
        coverage_rate: row[5] ? String(row[5]) : '',
        mix_time: row[6] ? String(row[6]) : '',
        mix_speed: row[7] ? String(row[7]) : '',
        status: 'Not Ordered',
        arrival_date: null,
        notes: ''
      })
    }
  }

  return materials
}

/* ── main component ── */

export default function Materials() {
  const [jobs, setJobs] = useState([])
  const [materials, setMaterials] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [expandedJobs, setExpandedJobs] = useState({})

  const fetchData = useCallback(async () => {
    const [jobsRes, matsRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('job_id, job_num, job_name, work_type, prevailing_wage, status, deleted')
        .or('deleted.is.null,deleted.eq.No')
        .in('status', ['Ongoing', 'On Hold'])
        .order('job_num', { ascending: true }),
      supabase
        .from('materials')
        .select('*')
        .order('ordinal', { ascending: true })
    ])

    if (jobsRes.error) {
      setError(jobsRes.error.message)
      setLoading(false)
      return
    }
    if (matsRes.error) {
      setError(matsRes.error.message)
      setLoading(false)
      return
    }

    setJobs(jobsRes.data || [])

    // Group materials by job_id
    const grouped = {}
    for (const m of (matsRes.data || [])) {
      if (!grouped[m.job_id]) grouped[m.job_id] = []
      grouped[m.job_id].push(m)
    }
    setMaterials(grouped)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const toggleExpand = (jobId) => {
    setExpandedJobs(prev => ({ ...prev, [jobId]: !prev[jobId] }))
  }

  const handleUploadSOW = async (jobId, file) => {
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const parsed = parseSOW(workbook)

      if (parsed.length === 0) {
        alert('No materials found in file. Check that the SOW format matches expected layout.')
        return
      }

      // Insert materials for this job
      const toInsert = parsed.map(m => ({
        job_id: jobId,
        ordinal: m.ordinal,
        name: m.name,
        status: m.status,
        arrival_date: m.arrival_date,
        notes: m.notes,
        phase: m.phase,
        task: m.task,
        kit_size: m.kit_size,
        qty_ordered: m.qty_ordered,
        coverage_rate: m.coverage_rate,
        mils: m.mils,
        mix_time: m.mix_time,
        mix_speed: m.mix_speed
      }))

      const { error: insertError } = await supabase
        .from('materials')
        .insert(toInsert)

      if (insertError) {
        alert('Error uploading materials: ' + insertError.message)
        return
      }

      // Refresh data
      await fetchData()
      setExpandedJobs(prev => ({ ...prev, [jobId]: true }))
    } catch (err) {
      alert('Error reading file: ' + err.message)
    }
  }

  const handleClear = async (jobId, jobName) => {
    if (!confirm(`Clear ALL materials for ${jobName}? This cannot be undone.`)) return

    const { error: delError } = await supabase
      .from('materials')
      .delete()
      .eq('job_id', jobId)

    if (delError) {
      alert('Error clearing materials: ' + delError.message)
      return
    }

    await fetchData()
  }

  const handleFieldUpdate = async (jobId, ordinal, field, value) => {
    const { error: updError } = await supabase
      .from('materials')
      .update({ [field]: value })
      .eq('job_id', jobId)
      .eq('ordinal', ordinal)

    if (updError) {
      alert('Error updating: ' + updError.message)
      return
    }

    // Update local state
    setMaterials(prev => {
      const updated = { ...prev }
      if (updated[jobId]) {
        updated[jobId] = updated[jobId].map(m =>
          m.ordinal === ordinal ? { ...m, [field]: value } : m
        )
      }
      return updated
    })
  }

  if (loading) return <div className="loading">Loading materials...</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  // Filter jobs by search
  const searchLower = search.toLowerCase()
  const filtered = search
    ? jobs.filter(j =>
        (j.job_name || '').toLowerCase().includes(searchLower) ||
        (j.job_num || '').toString().toLowerCase().includes(searchLower) ||
        (j.work_type || '').toLowerCase().includes(searchLower)
      )
    : jobs

  return (
    <div className="mat-wrap">
      {/* Search */}
      <div className="mat-search-bar">
        <input
          type="text"
          className="mat-search-input"
          placeholder="Search jobs by name, number, or work type..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="mat-search-clear" onClick={() => setSearch('')}>
            &times;
          </button>
        )}
      </div>

      {/* Header */}
      <div className="mat-header">
        Materials by Job ({filtered.length} active)
      </div>

      {/* Job Cards */}
      {filtered.length === 0 && (
        <div className="mat-empty">No matching jobs found.</div>
      )}

      {filtered.map(job => (
        <JobMaterialCard
          key={job.job_id}
          job={job}
          mats={materials[job.job_id] || []}
          expanded={!!expandedJobs[job.job_id]}
          onToggle={() => toggleExpand(job.job_id)}
          onUpload={(file) => handleUploadSOW(job.job_id, file)}
          onClear={() => handleClear(job.job_id, job.job_name)}
          onFieldUpdate={(ordinal, field, value) =>
            handleFieldUpdate(job.job_id, ordinal, field, value)
          }
        />
      ))}
    </div>
  )
}

/* ── Job Material Card ── */

function JobMaterialCard({ job, mats, expanded, onToggle, onUpload, onClear, onFieldUpdate }) {
  const fileRef = useRef(null)

  const workTypes = (job.work_type || '').split(',').map(s => s.trim()).filter(Boolean)
  const matCount = mats.length
  const phases = [...new Set(mats.map(m => m.phase).filter(Boolean))]
  const phaseCount = phases.length
  const hasSOW = matCount > 0

  // Stock status
  const allInStock = matCount > 0 && mats.every(m => m.status === 'In Stock')
  const pendingCount = mats.filter(m => m.status !== 'In Stock').length

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      onUpload(file)
      e.target.value = ''
    }
  }

  // Group materials by phase
  const groupedByPhase = []
  const phaseMap = {}
  for (const m of mats) {
    const key = m.phase || '(No Phase)'
    if (!phaseMap[key]) {
      phaseMap[key] = { phase: key, task: m.task || '', items: [] }
      groupedByPhase.push(phaseMap[key])
    }
    phaseMap[key].items.push(m)
  }

  return (
    <div className={`mat-card${expanded ? ' mat-card-expanded' : ''}`}>
      {/* Card Header */}
      <div className="mat-card-header" onClick={onToggle}>
        <div className="mat-card-title-row">
          <div className="mat-card-title">
            <span className="mat-job-num">{job.job_num}</span>
            <span className="mat-job-sep"> - </span>
            <span className="mat-job-name">{job.job_name}</span>
            {isPW(job) && <span className="mat-pw-badge">PW</span>}
          </div>
          <div className="mat-card-expand-icon">{expanded ? '\u25B2' : '\u25BC'}</div>
        </div>

        <div className="mat-card-meta">
          {/* Work type tags */}
          <div className="mat-tags">
            {workTypes.map(wt => (
              <span key={wt} className={`mat-tag ${gTagClass(wt)}`}>{wt}</span>
            ))}
          </div>

          {/* Counts */}
          <span className="mat-count">{matCount} material{matCount !== 1 ? 's' : ''}</span>
          {phaseCount > 0 && (
            <span className="mat-count">{phaseCount} phase{phaseCount !== 1 ? 's' : ''}</span>
          )}

          {/* SOW badge */}
          <span className={`mat-sow-badge ${hasSOW ? 'mat-sow-yes' : 'mat-sow-no'}`}>
            {hasSOW ? '\u2713 SOW' : '\u2717 No SOW'}
          </span>

          {/* Stock status badge */}
          {matCount > 0 && (
            <span className={`mat-stock-badge ${allInStock ? 'mat-stock-good' : 'mat-stock-pending'}`}>
              {allInStock ? 'In Stock' : `${pendingCount} pending`}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="mat-card-actions">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          className="mat-btn mat-btn-upload"
          onClick={(e) => { e.stopPropagation(); fileRef.current.click() }}
        >
          Upload SOW
        </button>
        {hasSOW && (
          <button
            className="mat-btn mat-btn-clear"
            onClick={(e) => { e.stopPropagation(); onClear() }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Material Table (expanded) */}
      {expanded && (
        <div className="mat-table-wrap">
          {matCount === 0 ? (
            <div className="mat-empty-table">
              No materials uploaded. Use "Upload SOW" to import from a spreadsheet.
            </div>
          ) : (
            groupedByPhase.map(group => (
              <div key={group.phase} className="mat-phase-group">
                <div className="mat-phase-header">
                  <span className="mat-phase-name">{group.phase}</span>
                  {group.task && (
                    <span className="mat-phase-task">{group.task}</span>
                  )}
                </div>
                <table className="mat-table">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Kit Size</th>
                      <th>Qty</th>
                      <th>Coverage</th>
                      <th>Status</th>
                      <th>Arrival</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(m => (
                      <MaterialRow
                        key={m.ordinal}
                        mat={m}
                        onFieldUpdate={onFieldUpdate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ── Material Row ── */

function MaterialRow({ mat, onFieldUpdate }) {
  const [localNotes, setLocalNotes] = useState(mat.notes || '')
  const [localArrival, setLocalArrival] = useState(mat.arrival_date || '')
  const notesTimer = useRef(null)
  const arrivalTimer = useRef(null)

  // Sync local state if mat prop changes
  useEffect(() => {
    setLocalNotes(mat.notes || '')
    setLocalArrival(mat.arrival_date || '')
  }, [mat.notes, mat.arrival_date])

  const handleStatusChange = (e) => {
    onFieldUpdate(mat.ordinal, 'status', e.target.value)
  }

  const handleNotesChange = (e) => {
    const val = e.target.value
    setLocalNotes(val)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      onFieldUpdate(mat.ordinal, 'notes', val)
    }, 600)
  }

  const handleArrivalChange = (e) => {
    const val = e.target.value
    setLocalArrival(val)
    clearTimeout(arrivalTimer.current)
    arrivalTimer.current = setTimeout(() => {
      onFieldUpdate(mat.ordinal, 'arrival_date', val || null)
    }, 600)
  }

  const color = statusColor(mat.status)

  return (
    <tr className="mat-row">
      <td className="mat-cell-name">{mat.name}</td>
      <td className="mat-cell-kit">{mat.kit_size || ''}</td>
      <td className="mat-cell-qty">{mat.qty_ordered ?? ''}</td>
      <td className="mat-cell-coverage">{mat.coverage_rate || ''}</td>
      <td className="mat-cell-status">
        <select
          className="mat-status-select"
          value={mat.status || 'Not Ordered'}
          onChange={handleStatusChange}
          style={{ borderColor: color, color: color }}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </td>
      <td className="mat-cell-arrival">
        <input
          type="date"
          className="mat-arrival-input"
          value={localArrival}
          onChange={handleArrivalChange}
        />
      </td>
      <td className="mat-cell-notes">
        <input
          type="text"
          className="mat-notes-input"
          value={localNotes}
          onChange={handleNotesChange}
          placeholder="Notes..."
        />
      </td>
    </tr>
  )
}
