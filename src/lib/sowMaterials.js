// DMS-1 Phase 3 §2 — pure rollup of a WTC field_sow into per-logical-material
// "Needed" lines. NO I/O (pure over its input). The audit-logged writer in
// queries.js consumes this and upserts job_material_lines; the Logistics view
// joins the warehouse row (qty_ordered/status/arrival/notes) onto these by
// material_key. See docs/plans/daily_material_schedule_phase3_build.md §1/§2.
//
// Grain (Chris-ratified 2026-07-30, REG-4): one entry per STABLE logical need
// = (normalized task.description, catalog_id ?? product). task_ref is a fresh
// uid minted per day, so the SAME logical task on N days has N task_refs —
// grouping on the stable identity (not task_ref) is what stops the N× overcount
// (§2 item 6 BUILD-VERIFY). task.size is the whole-task total (pct_complete
// allocates it across days), so Needed is computed ONCE per group, never summed.

// The five CAN'T-TELL reasons (VERIFY / amber ?). A null reason = computable
// (writer decides OK vs SHORT from the row's existing qty_ordered).
export const COVERAGE_REASONS = {
  NO_TASK_TAG: 'NO_TASK_TAG',       // material not tagged to a task
  NO_TASK_SIZE: 'NO_TASK_SIZE',     // task has no size (old/blank task)
  NO_COVERAGE: 'NO_COVERAGE',       // coverage_rate blank / range / no denominator / unparseable
  UNIT_MISMATCH: 'UNIT_MISMATCH',   // coverage area-unit ≠ task.unit
  UNIT_UNSUPPORTED: 'UNIT_UNSUPPORTED', // task.unit ∉ {SQFT, LF}
}

// Dispense (denominator) units that legitimize a "rate" — "200 sqft / gal".
const DISPENSE_UNITS = ['gal', 'kit', 'unit', 'pail', 'can', 'box']

const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// Normalize an area-unit token to exactly {SQFT, LF} or null (§2 round-3).
export function normalizeAreaUnit(tok) {
  if (tok == null) return null
  const s = String(tok).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (['sqft', 'sf', 'sq', 'ft2', 'sqfeet', 'squarefeet', 'sqfoot'].includes(s)) return 'SQFT'
  if (['lf', 'ft', 'lnft', 'linft', 'linearfeet', 'lin', 'linearfoot', 'lft'].includes(s)) return 'LF'
  return null
}

// Parse a coverage_rate TEXT string per §2 (round-3 hardened):
//  - strip commas, then parseFloat the LEADING numeric token = coverage number
//  - a rate REQUIRES a denominator token (`per` or a dispense unit) — else NO_COVERAGE
//  - a range ("130 to 154") → NO_COVERAGE (not a single rate)
//  - the area-unit is the token right after the number, normalized to {SQFT,LF}
// Returns { number, areaUnit } on success, or { reason: 'NO_COVERAGE' }.
export function parseCoverageRate(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { reason: COVERAGE_REASONS.NO_COVERAGE }
  const cleaned = raw.replace(/,/g, '')
  // A range is not a single rate.
  if (/\d\s*(?:-|–|—|to)\s*\d/i.test(cleaned)) return { reason: COVERAGE_REASONS.NO_COVERAGE }
  // Leading numeric token = the coverage number.
  const numMatch = cleaned.match(/^\s*([0-9]*\.?[0-9]+)/)
  if (!numMatch) return { reason: COVERAGE_REASONS.NO_COVERAGE }
  const number = parseFloat(numMatch[1])
  if (!isFinite(number) || number <= 0) return { reason: COVERAGE_REASONS.NO_COVERAGE }
  // Denominator required: the word `per` OR a dispense unit token.
  const hasDenominator = /\bper\b/i.test(cleaned) ||
    new RegExp(`\\b(?:${DISPENSE_UNITS.join('|')})s?\\b`, 'i').test(cleaned)
  if (!hasDenominator) return { reason: COVERAGE_REASONS.NO_COVERAGE }
  // Area-unit = the token immediately after the number (before the denominator).
  const rest = cleaned.slice(numMatch[0].length)
  const unitMatch = rest.match(/^\s*([a-z][a-z0-9]*)/i)
  const areaUnit = normalizeAreaUnit(unitMatch ? unitMatch[1] : null)
  // Can't confirm the area unit → can't trust the rate for a units comparison.
  if (areaUnit == null) return { reason: COVERAGE_REASONS.NO_COVERAGE }
  return { number, areaUnit }
}

// Decide qty_needed + coverage_reason for one grouped need.
// reason === null means computable (qty_needed is a number).
function computeNeeded(g) {
  if (!g.has_task) return { qty_needed: null, reason: COVERAGE_REASONS.NO_TASK_TAG, parsed_coverage: null }
  if (g.task_size == null) return { qty_needed: null, reason: COVERAGE_REASONS.NO_TASK_SIZE, parsed_coverage: null }
  const pc = parseCoverageRate(g.coverage)
  if (pc.reason) return { qty_needed: null, reason: pc.reason, parsed_coverage: null }
  const taskUnit = normalizeAreaUnit(g.task_unit)
  if (taskUnit == null) return { qty_needed: null, reason: COVERAGE_REASONS.UNIT_UNSUPPORTED, parsed_coverage: pc.number }
  if (pc.areaUnit !== taskUnit) return { qty_needed: null, reason: COVERAGE_REASONS.UNIT_MISMATCH, parsed_coverage: pc.number }
  // Needed = task total size ÷ coverage number (exact quotient; no round-up — R3).
  return { qty_needed: g.task_size / pc.number, reason: null, parsed_coverage: pc.number }
}

// Roll a WTC field_sow (array of day objects) into per-logical-material needs.
// Returns an array of { key, material_key, name, kit_size, coverage, supplier,
//   catalog_id, specs, task_description, task_size, task_unit, members[],
//   qty_needed, coverage_reason, parsed_coverage }.
export function rollupSowMaterials(fieldSow) {
  const days = Array.isArray(fieldSow) ? fieldSow : []
  const groups = new Map()

  for (const day of days) {
    const dayTasks = Array.isArray(day?.tasks) ? day.tasks : []
    const taskById = new Map(dayTasks.map(t => [String(t.id), t]))
    const mats = Array.isArray(day?.materials) ? day.materials : []
    for (const m of mats) {
      const task = (m.task_ref != null && m.task_ref !== '') ? taskById.get(String(m.task_ref)) : null
      // Stable logical identity — NOT task_ref (fresh per day → would not dedupe).
      const matIdent = m.catalog_id != null ? `cat:${m.catalog_id}` : `name:${norm(m.name || m.product)}`
      const taskIdent = task ? `task:${norm(task.description)}` : 'task:∅'
      const key = `${taskIdent}||${matIdent}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          // Representative wtc_material_id = first seen (DB row key). For the
          // dominant proposal path this is stable (shared across days anyway).
          material_key: String(m.wtc_material_id),
          name: m.name || m.product || 'Unnamed material',
          kit_size: m.kit_size || m.kit || null,
          coverage: m.coverage_rate || null,   // TEXT display (distinct from coverage_reason)
          supplier: m.supplier ?? null,
          catalog_id: m.catalog_id ?? null,
          specs: {
            mils: m.mils ?? null, coverage_rate: m.coverage_rate ?? null,
            mix_time: m.mix_time ?? null, mix_speed: m.mix_speed ?? null,
            cure_time: m.cure_time ?? null, unit: m.unit ?? null,
            specs_confirmed: m.specs_confirmed ?? null,
            specs_stamped_at: m.specs_stamped_at ?? null,
            spec_overrides: m.spec_overrides ?? null,
          },
          has_task: false,
          task_description: null,
          task_size: null,
          task_unit: null,
          members: [],
        })
      }
      const g = groups.get(key)
      g.members.push({ wtc_material_id: String(m.wtc_material_id), day_label: day?.day_label ?? null })
      if (task) {
        g.has_task = true
        // Read the task's total size ONCE (days agree — same logical task). Prefer
        // the first defined size so a later blank day-instance can't null it out.
        if (g.task_size == null && task.size != null) g.task_size = task.size
        if (g.task_description == null) g.task_description = task.description ?? null
        if (g.task_unit == null) g.task_unit = task.unit ?? null
      }
    }
  }

  return Array.from(groups.values()).map(g => {
    const v = computeNeeded(g)
    return { ...g, qty_needed: v.qty_needed, coverage_reason: v.reason, parsed_coverage: v.parsed_coverage }
  })
}

// Resolve the display flag from a persisted row (§2). status:
//   'OK' → green ✓ · 'SHORT' → red ⚠ · 'VERIFY' → amber ? (tooltip = coverage_reason)
// Pure: given qty_needed (from rollup) + qty_ordered (warehouse) + reason.
export function coverageStatusFor(qtyNeeded, qtyOrdered, reason) {
  if (reason) return 'VERIFY'
  if (qtyNeeded == null) return 'VERIFY'
  const ordered = Number(qtyOrdered) || 0
  return ordered >= qtyNeeded ? 'OK' : 'SHORT'
}
