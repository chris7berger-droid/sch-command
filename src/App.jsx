import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { supabase } from './lib/supabase'
import { getSession, onAuthStateChange, signOut, getCurrentTeamMember } from './lib/auth'
import { useSync } from './lib/sync'
import { useToast } from './lib/toast'
import { printWeekSchedule, printJobList, printBillingReport, printMaterialsList, printDailyStatus } from './lib/exports'
import Jobs from './views/Jobs'
import Schedule from './views/Schedule'
import Billing from './views/Billing'
import Materials from './views/Materials'
import Calendar from './views/Calendar'
import Daily from './views/Daily'
import Schedules from './views/Schedules'
import StatsBar from './components/StatsBar'
import Login from './views/Login'
import { ScheduleCommandMark } from './components/Logo'

const NAV_ITEMS = [
  { path: '/jobs', label: 'Jobs' },
  { path: '/schedule', label: 'Crew Schedule' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/daily', label: 'Daily' },
  { path: '/materials', label: 'Materials' },
  { path: '/billing', label: 'Billing' },
  { path: '/schedules', label: 'Schedules' },
]

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [teamMember, setTeamMember] = useState(null)

  useEffect(() => {
    getSession().then(s => setSession(s ?? null))
    const sub = onAuthStateChange(async (event, s) => {
      if (event === 'PASSWORD_RECOVERY') { setSession(null); return }
      setSession(s ?? null)
      if (s) {
        const member = await getCurrentTeamMember()
        setTeamMember(member)
      } else {
        setTeamMember(null)
      }
    })
    return () => sub.unsubscribe()
  }, [])

  // Loading state
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-light)', letterSpacing: '0.1em' }}>
        LOADING…
      </div>
    )
  }

  // Not logged in — skip login on localhost for dev
  const isDev = window.location.hostname === 'localhost'
  if (!session && !isDev) return <Login />

  return <AppShell session={session} teamMember={teamMember} />
}

function AppShell({ session, teamMember }) {
  const { syncState, setSync } = useSync()
  const toast = useToast()
  const [modal, setModal] = useState(null)
  const [workTypes, setWorkTypes] = useState([])
  const [crewList, setCrewList] = useState([])
  const [showArchived, setShowArchived] = useState(false)

  // Load work types + crew for modals
  const loadModalData = useCallback(async () => {
    const [wtRes, crewRes] = await Promise.all([
      supabase.from('work_types').select('*'),
      supabase.from('crew').select('*'),
    ])
    if (wtRes.data) setWorkTypes(wtRes.data.map(w => w.name))
    if (crewRes.data) setCrewList(crewRes.data)
  }, [])

  useEffect(() => { loadModalData() }, [loadModalData])

  function closeModal() { setModal(null) }

  // --- Add Job ---
  const [jobForm, setJobForm] = useState({})
  const [jobWtSelected, setJobWtSelected] = useState([])

  function openAddJob() {
    setJobForm({ job_num: '', job_name: '', amount: '', crew_needed: '3', lead: '', vehicle: '', equipment: '', power_source: '', sow: '', start_date: '', end_date: '', prevailing_wage: false })
    setJobWtSelected([])
    setModal('job')
  }

  async function doAddJob() {
    const f = jobForm
    const row = {
      job_num: f.job_num || 'NEW',
      job_name: f.job_name || 'Untitled',
      amount: f.amount ? '$' + f.amount : '',
      work_type: jobWtSelected.join(','),
      crew_needed: f.crew_needed || '',
      lead: f.lead,
      vehicle: f.vehicle,
      equipment: f.equipment,
      power_source: f.power_source,
      sow: f.sow,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      prevailing_wage: f.prevailing_wage ? 'Yes' : 'No',
      status: 'Ongoing',
    }
    setSync('ing')
    const { error } = await supabase.from('jobs').insert([row])
    if (error) { console.error(error); setSync('bad'); toast('Error adding job', 'err'); return }
    setSync('ok')
    toast('Job added', 'ok')
    closeModal()
  }

  // --- Add Crew ---
  const [crewForm, setCrewForm] = useState({})

  function openAddCrew() {
    setCrewForm({ name: '', team: '', phone: '' })
    setModal('crew')
  }

  async function doAddCrew() {
    if (!crewForm.name) { toast('Name required', 'err'); return }
    const row = { name: crewForm.name, team: crewForm.team || 'Floater', phone: crewForm.phone || null }
    setSync('ing')
    const { error } = await supabase.from('crew').insert([row])
    if (error) { console.error(error); setSync('bad'); toast('Error', 'err'); return }
    setSync('ok')
    toast('Crew added', 'ok')
    await loadModalData()
    closeModal()
  }

  // --- Work Types ---
  const [newWt, setNewWt] = useState('')

  async function doAddWorkType() {
    if (!newWt.trim()) return
    const { error } = await supabase.from('work_types').insert([{ name: newWt.trim() }])
    if (error) { console.error(error); return }
    setNewWt('')
    await loadModalData()
  }

  async function doDeleteWorkType(name) {
    const { error } = await supabase.from('work_types').delete().eq('name', name)
    if (error) { console.error(error); return }
    await loadModalData()
  }

  // --- Crew List ---
  const [clForm, setClForm] = useState({ name: '', team: '', phone: '' })

  async function clAdd() {
    if (!clForm.name) return
    const row = { name: clForm.name, team: clForm.team || 'Floater', phone: clForm.phone || null }
    const { error } = await supabase.from('crew').insert([row])
    if (error) { console.error(error); return }
    setClForm({ name: '', team: '', phone: '' })
    await loadModalData()
  }

  async function clArchive(name) {
    if (!confirm('Archive ' + flipName(name) + '? They will be hidden from active views.')) return
    const { error } = await supabase.from('crew').update({ archived: 'Yes' }).eq('name', name)
    if (error) { console.error(error); return }
    await loadModalData()
  }

  async function clUnarchive(name) {
    const { error } = await supabase.from('crew').update({ archived: 'No' }).eq('name', name)
    if (error) { console.error(error); return }
    toast(flipName(name) + ' restored', 'ok')
    await loadModalData()
  }

  // Crew edit
  const [editingCrew, setEditingCrew] = useState(null) // { name, team, phone, originalName }

  async function clSave() {
    if (!editingCrew) return
    const updates = { team: editingCrew.team, phone: editingCrew.phone }
    // If name changed, need to update name too
    if (editingCrew.name !== editingCrew.originalName) {
      // Update crew name and all assignments referencing it
      updates.name = editingCrew.name
    }
    const { error } = await supabase.from('crew').update(updates).eq('name', editingCrew.originalName)
    if (error) { console.error(error); toast('Error saving', 'err'); return }
    if (editingCrew.name !== editingCrew.originalName) {
      await supabase.from('assignments').update({ crew_name: editingCrew.name }).eq('crew_name', editingCrew.originalName)
      await supabase.from('crew_status').update({ crew_name: editingCrew.name }).eq('crew_name', editingCrew.originalName)
    }
    toast('Crew updated', 'ok')
    setEditingCrew(null)
    await loadModalData()
  }

  async function clDelete(name) {
    if (!confirm('Delete ' + flipName(name) + '? This cannot be undone.')) return
    await supabase.from('assignments').delete().eq('crew_name', name)
    await supabase.from('crew_status').delete().eq('crew_name', name)
    const { error } = await supabase.from('crew').delete().eq('name', name)
    if (error) { console.error(error); toast('Error', 'err'); return }
    toast(flipName(name) + ' deleted', 'wrn')
    await loadModalData()
  }

  // --- Refresh ---
  function handleRefresh() {
    loadModalData()
    window.location.reload()
  }

  const activeCrew = crewList.filter(c => c.archived !== 'Yes')
  const archivedCrew = crewList.filter(c => c.archived === 'Yes')

  return (
    <>
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-title">
            <ScheduleCommandMark size={42} />
            <span>Schedule <span className="green">Command</span></span>
            <span className={`sync-dot sync-${syncState}`} />
          </div>
          <div className="app-actions">
            <div className="app-actions-label">Actions</div>
            <div className="app-actions-row">
              <button className="app-act-btn" onClick={handleRefresh}>Refresh</button>
              <button className="app-act-btn" onClick={openAddJob}>+ Job</button>
              <button className="app-act-btn" onClick={openAddCrew}>+ Crew</button>
              <button className="app-act-btn" onClick={() => { setModal('workTypes') }}>Work Types</button>
              <button className="app-act-btn" onClick={() => { setModal('crewList') }}>Crew List</button>
              <button className="app-act-btn" onClick={() => { setModal('sendSchedules') }}>Send Schedules</button>
              <button className="app-act-btn app-act-primary" onClick={() => { setModal('export') }}>Export</button>
              <button className="app-act-btn" onClick={() => signOut()} style={{ opacity: 0.6 }}>Sign Out</button>
            </div>
          </div>
        </div>
        <nav className="app-nav">
          <span className="app-nav-label">Views</span>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <StatsBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/daily" element={<Daily />} />
          <Route path="/schedules" element={<Schedules />} />
        </Routes>
      </main>

      {/* Add Job Modal */}
      {modal === 'job' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Add Job</h3>
            <div className="mfr">
              <input placeholder="Job #" value={jobForm.job_num || ''} onChange={e => setJobForm(p => ({ ...p, job_num: e.target.value }))} />
              <input placeholder="Customer Name" value={jobForm.job_name || ''} onChange={e => setJobForm(p => ({ ...p, job_name: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Proposal $" value={jobForm.amount || ''} onChange={e => setJobForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="mfr-label">Work Types</div>
            <div className="mwt-wrap">
              {workTypes.map(wt => (
                <label key={wt} className={`mwt-chip${jobWtSelected.includes(wt) ? ' mwt-on' : ''}`}>
                  <input type="checkbox" checked={jobWtSelected.includes(wt)} onChange={() => setJobWtSelected(p => p.includes(wt) ? p.filter(x => x !== wt) : [...p, wt])} style={{ width: 12, height: 12 }} />
                  {wt}
                </label>
              ))}
            </div>
            <div className="mfr">
              <input type="number" min="1" placeholder="Crew#" value={jobForm.crew_needed || ''} onChange={e => setJobForm(p => ({ ...p, crew_needed: e.target.value }))} />
              <input placeholder="Lead/Sales" value={jobForm.lead || ''} onChange={e => setJobForm(p => ({ ...p, lead: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Vehicle" value={jobForm.vehicle || ''} onChange={e => setJobForm(p => ({ ...p, vehicle: e.target.value }))} />
              <input placeholder="Equipment" value={jobForm.equipment || ''} onChange={e => setJobForm(p => ({ ...p, equipment: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Power Source" value={jobForm.power_source || ''} onChange={e => setJobForm(p => ({ ...p, power_source: e.target.value }))} />
              <input placeholder="Scope of Work" value={jobForm.sow || ''} onChange={e => setJobForm(p => ({ ...p, sow: e.target.value }))} />
            </div>
            <div className="mfr">
              <input type="date" value={jobForm.start_date || ''} onChange={e => setJobForm(p => ({ ...p, start_date: e.target.value }))} />
              <input type="date" value={jobForm.end_date || ''} onChange={e => setJobForm(p => ({ ...p, end_date: e.target.value }))} />
            </div>
            <div className="mfr">
              <label className="mchk"><input type="checkbox" checked={jobForm.prevailing_wage || false} onChange={e => setJobForm(p => ({ ...p, prevailing_wage: e.target.checked }))} /> Prevailing Wage</label>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Cancel</button>
              <button className="app-act-btn app-act-primary" onClick={doAddJob}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Crew Modal */}
      {modal === 'crew' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Add Crew</h3>
            <div className="mfr">
              <input placeholder="Name (Last, First)" value={crewForm.name || ''} onChange={e => setCrewForm(p => ({ ...p, name: e.target.value }))} />
              <input placeholder="Team # or Floater" value={crewForm.team || ''} onChange={e => setCrewForm(p => ({ ...p, team: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Phone (optional)" value={crewForm.phone || ''} onChange={e => setCrewForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Cancel</button>
              <button className="app-act-btn app-act-primary" onClick={doAddCrew}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Work Types Modal */}
      {modal === 'workTypes' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Work Types</h3>
            <div className="mwt-list">
              {workTypes.map(wt => (
                <div key={wt} className="mwt-row">
                  <span>{wt}</span>
                  <button className="mwt-del" onClick={() => doDeleteWorkType(wt)}>{'\u2715'}</button>
                </div>
              ))}
            </div>
            <div className="mfr">
              <input placeholder="New work type" value={newWt} onChange={e => setNewWt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doAddWorkType() }} />
              <button className="app-act-btn app-act-primary" onClick={doAddWorkType}>Add</button>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Crew List Modal */}
      {modal === 'crewList' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl mdl-wide">
            <h3>Crew List</h3>
            <table className="mcl-tbl">
              <thead>
                <tr><th>Name</th><th>Team</th><th>Phone</th><th style={{ width: 140 }}>Actions</th></tr>
              </thead>
              <tbody>
                {activeCrew.map(c => {
                  const isEditing = editingCrew && editingCrew.originalName === c.name
                  return (
                    <tr key={c.name}>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.name} onChange={e => setEditingCrew(p => ({ ...p, name: e.target.value }))} /> : flipName(c.name)}</td>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.team} onChange={e => setEditingCrew(p => ({ ...p, team: e.target.value }))} /> : (c.team || '\u2014')}</td>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.phone || ''} onChange={e => setEditingCrew(p => ({ ...p, phone: e.target.value }))} /> : (c.phone || '\u2014')}</td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        {isEditing ? (
                          <>
                            <button className="app-act-btn app-act-sm" style={{ background: 'var(--command-green)', color: '#fff', borderColor: 'var(--command-green)' }} onClick={clSave}>Save</button>
                            <button className="app-act-btn app-act-sm" onClick={() => setEditingCrew(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="app-act-btn app-act-sm" onClick={() => setEditingCrew({ name: c.name, team: c.team || '', phone: c.phone || '', originalName: c.name })}>Edit</button>
                            <button className="app-act-btn app-act-sm" onClick={() => clArchive(c.name)}>Archive</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {activeCrew.length === 0 && <div className="mcl-empty">No active crew members</div>}
            <div className="mcl-add">
              <div className="mfr-label">Add New</div>
              <div className="mfr">
                <input placeholder="Name (Last, First)" value={clForm.name} onChange={e => setClForm(p => ({ ...p, name: e.target.value }))} />
                <input placeholder="Team # or Floater" value={clForm.team} onChange={e => setClForm(p => ({ ...p, team: e.target.value }))} />
                <input placeholder="Phone" value={clForm.phone} onChange={e => setClForm(p => ({ ...p, phone: e.target.value }))} />
                <button className="app-act-btn app-act-primary" onClick={clAdd}>Add</button>
              </div>
            </div>
            <div className="mcl-archived-toggle" onClick={() => setShowArchived(!showArchived)}>
              Archived ({archivedCrew.length}) {showArchived ? '\u25B4' : '\u25BE'}
            </div>
            {showArchived && archivedCrew.map(c => (
              <div key={c.name} className="mcl-arch-row">
                <span>{flipName(c.name)}</span>
                <button className="app-act-btn app-act-sm" onClick={() => clUnarchive(c.name)}>Restore</button>
              </div>
            ))}
            {showArchived && archivedCrew.length === 0 && <div className="mcl-empty">No archived crew members</div>}
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Schedules - placeholder */}
      {modal === 'sendSchedules' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Send Schedules</h3>
            <p style={{ fontSize: 12, color: 'var(--sand-dark)' }}>Crew card flipper not yet built. This will open the Schedules view card sender.</p>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Menu */}
      {modal === 'export' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Export</h3>
            <div className="mwt-list">
              <div className="mwt-row" onClick={() => { printWeekSchedule(); closeModal() }}>Week Schedule</div>
              <div className="mwt-row" onClick={() => { printJobList(); closeModal() }}>Job List</div>
              <div className="mwt-row" onClick={() => { printBillingReport(); closeModal() }}>Billing Report</div>
              <div className="mwt-row" onClick={() => { printMaterialsList(); closeModal() }}>Materials List</div>
              <div className="mwt-row" onClick={() => { printDailyStatus(); closeModal() }}>Daily Crew Status</div>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
