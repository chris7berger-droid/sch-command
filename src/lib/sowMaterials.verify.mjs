// Standalone BUILD-VERIFY for sowMaterials.js (DMS-1 Phase 3 §2). No test runner
// in this repo — run with:  node src/lib/sowMaterials.verify.mjs
// Proves the §2 item-6 requirement: a material used across multiple days is NOT
// multi-counted, plus the coverage-parse + CAN'T-TELL-reason spec.
import { rollupSowMaterials, parseCoverageRate, normalizeAreaUnit, coverageStatusFor, COVERAGE_REASONS as R }
  from './sowMaterials.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}${ok ? '' : `\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

// ── BUILD-VERIFY (§2 item 6): same material across 3 days must NOT triple-count ──
// Same logical task "Apply epoxy" (total size 5100 LF) split 34/33/33% across 3 days.
// CATALOG material (fresh uid per day → 3 distinct wtc_material_ids) tagged each day.
// Coverage 150 LF/gal → Needed = 5100/150 = 34, computed ONCE (not 102).
const threeDaySameCatalog = [
  { day_label: 'Day 1', tasks: [{ id: 'd1t1', description: 'Apply epoxy', size: 5100, unit: 'LF', pct_complete: 34 }],
    materials: [{ wtc_material_id: 'cat_aaa', catalog_id: 42, name: 'Epoxy X', kit_size: '5 gal', coverage_rate: '150 LF/gal', task_ref: 'd1t1' }] },
  { day_label: 'Day 2', tasks: [{ id: 'd2t1', description: 'Apply epoxy', size: 5100, unit: 'LF', pct_complete: 33 }],
    materials: [{ wtc_material_id: 'cat_bbb', catalog_id: 42, name: 'Epoxy X', kit_size: '5 gal', coverage_rate: '150 LF/gal', task_ref: 'd2t1' }] },
  { day_label: 'Day 3', tasks: [{ id: 'd3t1', description: 'Apply epoxy', size: 5100, unit: 'LF', pct_complete: 33 }],
    materials: [{ wtc_material_id: 'cat_ccc', catalog_id: 42, name: 'Epoxy X', kit_size: '5 gal', coverage_rate: '150 LF/gal', task_ref: 'd3t1' }] },
]
const r1 = rollupSowMaterials(threeDaySameCatalog)
eq('3-day same catalog material → ONE need (no 3×)', r1.length, 1)
eq('   qty_needed = 5100/150 = 34 (not 102)', r1[0]?.qty_needed, 34)
eq('   3 members tracked for traceability', r1[0]?.members.length, 3)
eq('   representative key = first wtc_material_id', r1[0]?.material_key, 'cat_aaa')
eq('   computable → no coverage_reason', r1[0]?.coverage_reason, null)

// Proposal path: SAME wtc_material_id across days (stable source id) → also ONE.
const threeDayProposal = [
  { day_label: 'Day 1', tasks: [{ id: 'p1', description: 'Coat floor', size: 2000, unit: 'SQFT', pct_complete: 50 }],
    materials: [{ wtc_material_id: '900', catalog_id: null, name: 'Primer', coverage_rate: '400 sqft per gal', task_ref: 'p1' }] },
  { day_label: 'Day 2', tasks: [{ id: 'p2', description: 'Coat floor', size: 2000, unit: 'SQFT', pct_complete: 50 }],
    materials: [{ wtc_material_id: '900', catalog_id: null, name: 'Primer', coverage_rate: '400 sqft per gal', task_ref: 'p2' }] },
]
const r2 = rollupSowMaterials(threeDayProposal)
eq('proposal same-id across days → ONE need', r2.length, 1)
eq('   qty_needed = 2000/400 = 5', r2[0]?.qty_needed, 5)

// Genuinely different tasks, same material → SEPARATE needs (must NOT collapse).
const twoDistinctTasks = [
  { day_label: 'Day 1', tasks: [{ id: 'a', description: 'Area A epoxy', size: 300, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'cat_1', catalog_id: 7, name: 'Epoxy', coverage_rate: '100 sqft/gal', task_ref: 'a' }] },
  { day_label: 'Day 2', tasks: [{ id: 'b', description: 'Area B epoxy', size: 600, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'cat_2', catalog_id: 7, name: 'Epoxy', coverage_rate: '100 sqft/gal', task_ref: 'b' }] },
]
const r3 = rollupSowMaterials(twoDistinctTasks)
eq('different task descriptions → TWO needs', r3.length, 2)
eq('   Area A needs 3, Area B needs 6', [r3[0]?.qty_needed, r3[1]?.qty_needed], [3, 6])

// ── CAN'T-TELL reasons ──
const reasonCase = (label, day, wantReason) => {
  const r = rollupSowMaterials([day])
  eq(label, r[0]?.coverage_reason, wantReason)
}
reasonCase('untagged material → NO_TASK_TAG',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '100 sqft/gal', task_ref: '' }] }, R.NO_TASK_TAG)
reasonCase('task with null size → NO_TASK_SIZE',
  { tasks: [{ id: 't', description: 'X', size: null, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '100 sqft/gal', task_ref: 't' }] }, R.NO_TASK_SIZE)
reasonCase('blank coverage → NO_COVERAGE',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '', task_ref: 't' }] }, R.NO_COVERAGE)
reasonCase('range coverage "130 to 154" → NO_COVERAGE',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '130 to 154 sqft/gal', task_ref: 't' }] }, R.NO_COVERAGE)
reasonCase('no denominator "200 sqft" → NO_COVERAGE',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'SQFT' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '200 sqft', task_ref: 't' }] }, R.NO_COVERAGE)
reasonCase('area-unit ≠ task.unit (SQFT vs LF) → UNIT_MISMATCH',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'LF' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '200 sqft/gal', task_ref: 't' }] }, R.UNIT_MISMATCH)
reasonCase('task.unit EA (∉ SQFT/LF) → UNIT_UNSUPPORTED',
  { tasks: [{ id: 't', description: 'X', size: 100, unit: 'EA' }],
    materials: [{ wtc_material_id: 'm', name: 'Y', coverage_rate: '200 sqft/gal', task_ref: 't' }] }, R.UNIT_UNSUPPORTED)

// ── parse unit / comma / normalize ──
eq('comma-strip "1,200 sqft/gal" → 1200', parseCoverageRate('1,200 sqft/gal').number, 1200)
eq('"250 SF per gallon" → SQFT', parseCoverageRate('250 SF per gallon').areaUnit, 'SQFT')
eq('"12 lf/kit" → LF', parseCoverageRate('12 lf/kit').areaUnit, 'LF')
eq('normalizeAreaUnit sf→SQFT', normalizeAreaUnit('sf'), 'SQFT')
eq('normalizeAreaUnit ft→LF', normalizeAreaUnit('ft'), 'LF')
eq('normalizeAreaUnit ea→null', normalizeAreaUnit('ea'), null)

// ── coverageStatusFor (writer's OK/SHORT/VERIFY) ──
eq('ordered ≥ needed → OK', coverageStatusFor(34, 40, null), 'OK')
eq('ordered < needed → SHORT', coverageStatusFor(34, 10, null), 'SHORT')
eq('has reason → VERIFY', coverageStatusFor(null, 0, R.NO_COVERAGE), 'VERIFY')
eq('ordered null, needed 34 → SHORT (0<34)', coverageStatusFor(34, null, null), 'SHORT')

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}  —  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
