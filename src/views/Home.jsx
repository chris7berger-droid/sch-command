import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  loadJobs, loadAllRows, loadPRTsForCallLogIds, loadMobilizationsByJobId,
  computeHomeDashboard, fmtD, getMonday, wkDates,
} from '../lib/queries'
import HomeCapacityStrip from '../components/HomeCapacityStrip'
import { NeedsAttention, NextUp, AtAGlance } from '../components/HomePanels'
import JobsToPrepare from '../components/JobsToPrepare'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Home() {
  const today = useMemo(() => new Date(), [])
  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = fmtD(new Date())
  const loadIdRef = useRef(0)

  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [weekAssignments, setWeekAssignments] = useState([])
  const [allAssignments, setAllAssignments] = useState([])
  const [crewStatusMap, setCrewStatusMap] = useState({})
  const [materials, setMaterials] = useState([])
  const [dailyLogs, setDailyLogs] = useState([])
  const [proposalMaterialsByCallLog, setProposalMaterialsByCallLog] = useState({})
  const [mobsByJobId, setMobsByJobId] = useState({})
  const [prtMap, setPrtMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async ({ background = false } = {}) => {
    const thisLoad = ++loadIdRef.current
    if (!background) setLoading(true)
    const wsStr = dates[0]
    const weStr = dates[dates.length - 1]
    const [jobsRes, allAsgnRes, weekAsgnRes, crewRes, csRes, matsRes, logsRes] = await Promise.all([
      loadJobs({ withWTCs: true }),
      supabase.from('assignments').select('*'),
      supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('crew').select('*'),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
      loadAllRows('job_material_lines', 'id, job_id, status', { orderBy: 'id' }),
      loadAllRows('daily_log_entries', 'id, job_id', { orderBy: 'id' }),
    ])
    if (thisLoad !== loadIdRef.current) return
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    const loadedJobs = jobsRes.data || []
    setJobs(loadedJobs)
    setAllAssignments(allAsgnRes.data || [])
    setWeekAssignments(weekAsgnRes.data || [])
    setCrew((crewRes.data || []).filter(c => c.archived !== 'Yes'))
    setMaterials(matsRes.data || [])
    setDailyLogs(logsRes.data || [])
    const csMap = {}
    for (const c of (csRes.data || [])) csMap[c.crew_name + '|' + c.date] = c.status
    setCrewStatusMap(csMap)

    // Batched proposal_wtc materials for the in-card SOW editor (matches Jobs.jsx).
    const pmCallLogIds = [...new Set(loadedJobs.map(j => j.call_log_id).filter(Boolean))]
    if (pmCallLogIds.length > 0) {
      const { data: pwData } = await supabase
        .from('proposal_wtc')
        .select('id, materials, proposals!inner(call_log_id)')
        .in('proposals.call_log_id', pmCallLogIds)
      if (thisLoad !== loadIdRef.current) return
      const pmMap = {}
      ;(pwData || []).forEach(w => {
        const clId = w.proposals?.call_log_id
        if (clId == null) return
        const arr = pmMap[clId] || (pmMap[clId] = [])
        ;(w.materials || []).forEach(m => { if (m && m.id != null) arr.push({ ...m, _wtc_id: w.id }) })
      })
      setProposalMaterialsByCallLog(pmMap)
    } else { setProposalMaterialsByCallLog({}) }

    if (loadedJobs.length > 0) {
      const mobs = await loadMobilizationsByJobId(loadedJobs)
      if (thisLoad !== loadIdRef.current) return
      setMobsByJobId(mobs)
    } else { setMobsByJobId({}) }

    const activeCallLogIds = loadedJobs
      .filter(j => j.status === 'In Progress' || j.status === 'Ongoing')
      .map(j => j.call_log_id).filter(Boolean)
    if (activeCallLogIds.length > 0) {
      const prtRes = await loadPRTsForCallLogIds(activeCallLogIds)
      if (thisLoad !== loadIdRef.current) return
      setPrtMap(prtRes.data)
    } else { setPrtMap(new Map()) }

    setLoading(false)
  }, [dates])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: reload on jobs / assignments / materials changes (mirrors Jobs.jsx).
  useEffect(() => {
    let timer = null
    const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => loadData({ background: true }), 300) }
    const channels = [
      supabase.channel('home-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debounced).subscribe(),
      supabase.channel('home-assignments').on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, debounced).subscribe(),
      supabase.channel('home-materials').on('postgres_changes', { event: '*', schema: 'public', table: 'job_material_lines' }, debounced).subscribe(),
    ]
    return () => { if (timer) clearTimeout(timer); channels.forEach(c => supabase.removeChannel(c)) }
  }, [loadData])

  const matsByJobId = useMemo(() => materials.reduce((m, r) => { (m[r.job_id] ||= []).push(r); return m }, {}), [materials])
  const assignmentsByJobId = useMemo(() => allAssignments.reduce((m, a) => { (m[a.job_id] ||= new Set()).add(a.date); return m }, {}), [allAssignments])
  const logsByCallLog = useMemo(() => dailyLogs.reduce((m, r) => { m[r.job_id] = (m[r.job_id] || 0) + 1; return m }, {}), [dailyLogs])

  const dash = useMemo(() => computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments, matsByJobId, dates, todayStr,
  }), [jobs, crew, crewStatusMap, weekAssignments, allAssignments, matsByJobId, dates, todayStr])

  const weekLabel = useMemo(() => {
    const a = new Date(dates[0] + 'T00:00:00'), b = new Date(dates[dates.length - 1] + 'T00:00:00')
    return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`
  }, [dates])

  if (loading) return <div className="home-screen"><div className="jh-empty">Loading…</div></div>
  if (error) return <div className="home-screen"><div className="jh-empty">Error: {error}</div></div>

  return (
    <div className="home-screen">
      <HomeCapacityStrip data={dash} weekLabel={weekLabel} />

      <div className="home-panels">
        <NeedsAttention data={dash} />
        <NextUp nextUp={dash.nextUp} />
        <AtAGlance data={dash} />
      </div>

      <JobsToPrepare
        jobs={jobs}
        crewByCallLog={dash.crewByAll}
        matsByJobId={matsByJobId}
        logsByCallLog={logsByCallLog}
        assignmentsByJobId={assignmentsByJobId}
        proposalMaterialsByCallLog={proposalMaterialsByCallLog}
        mobsByJobId={mobsByJobId}
        prtMap={prtMap}
        today={today}
        onJobUpdate={() => loadData({ background: true })}
      />
    </div>
  )
}
