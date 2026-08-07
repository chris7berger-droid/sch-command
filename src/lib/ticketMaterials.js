import { supabase } from './supabase'
import { loadJobWithWTCs } from './queries'

// DMS-1 D2 — canonical material-load + summary shared by BOTH the crew ticket
// (CrewTicket.jsx) and the warehouse receiving ticket (ReceivingTicket.jsx).
// Extracted verbatim from CrewTicket.jsx (2026-08-06) so the two sheets can NEVER
// disagree on a job's material totals — one function, one grouping, one order.
// See docs/plans/warehouse_receiving_ticket.md §2 (Option B, locked).

// Canonical material-name resolver (was CrewTicket.jsx:23).
export const uname = (m = {}) => m.product || m.name || 'Unnamed material'

// Load a job + its bid materials. The EXACT two-hop CrewTicket used (was :159-181):
// loadJobWithWTCs → the job's scheduled proposal_wtc ids → their materials arrays,
// flattened. Bid quantities live on proposal_wtc.materials (Sales-owned); read ONLY
// the proposal_wtc rows tied to this job's scheduled WTCs — inherently scoped, so
// nothing from unscheduled WTCs leaks in. Returns { job, bidMaterials, error }.
export async function loadBidMaterialsForJob(jobId) {
  const { data: jobData, error: jobErr } = await loadJobWithWTCs(jobId)
  if (jobErr) return { job: null, bidMaterials: [], error: jobErr }

  const wtcs = Array.isArray(jobData?._wtcs) ? jobData._wtcs : []
  const pwIds = wtcs.map(w => w.proposal_wtc_id).filter(Boolean)
  let mats = []
  if (pwIds.length > 0) {
    const { data: pwData, error: pwErr } = await supabase
      .from('proposal_wtc')
      .select('id, materials')
      .in('id', pwIds)
    if (pwErr) return { job: null, bidMaterials: [], error: pwErr }
    mats = (pwData || []).flatMap(w => Array.isArray(w.materials) ? w.materials : [])
  }
  return { job: jobData, bidMaterials: mats, error: null }
}

// Page-1 summary: group identical bid materials across WTCs, sum qty (was the
// CrewTicket.jsx:203-218 IIFE). Group by name AND kit_size — the same product in
// two kit sizes is two distinct order lines (summing them would order the wrong
// kit); same name + same kit sums across WTCs. Sorted deterministically by name
// then kit so the crew ticket and the receiving ticket ALWAYS list the same rows
// in the same order (round-1 audit finding).
export function summarizeBidMaterials(bidMaterials = []) {
  const map = new Map()
  for (const m of bidMaterials) {
    const name = uname(m)
    const kit = m.kit_size || ''
    const key = `${name}|${kit}`
    const qty = Number(m.qty) || 0
    const prev = map.get(key)
    if (prev) { prev.qty += qty }
    else map.set(key, { name, qty, kit_size: kit })
  }
  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.kit_size.localeCompare(b.kit_size)
  )
}
