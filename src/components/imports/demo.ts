import type { ImportInfo, ImportPick, ImportResult, ImportResultRow, ImportReview, ReviewRow } from '@/lib/mcp'

/** Sample staged import for the browser demo, where there is no MCP server. */
const ROWS: ReviewRow[] = [
  {
    rowKey: 'r0', fp: 'new', category: 'new', type: 'Requirement', key: 'SRS-0040', title: 'Export scan report as PDF', workItemId: null, matchedBy: null, parent: 3700, parentRow: null, error: null, note: null,
    changes: [
      { field: 'System.Title', name: 'Title', kind: 'set', before: '', after: 'Export scan report as PDF', write: true },
      { field: 'Custom.SRSID', name: 'SRS ID', kind: 'set', before: '', after: 'SRS-0040', write: true },
      { field: 'Custom.SoftwareRequirementSpecification', name: 'Software Requirement Specification', kind: 'set', before: '', after: 'The system shall export the scan report, including the Cobb angle measurements and images, as a PDF file.', write: true },
      { field: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', kind: 'set', before: '', after: 'Given a completed scan\nWhen the clinician selects Export → PDF\nThen a PDF with the report and images is saved\nAnd the file name contains the patient ID and scan date', write: true },
      { field: 'System.Parent', name: 'Parent', kind: 'set', before: '', after: '#3700', write: true },
    ],
  },
  {
    rowKey: 'r1', fp: 'new', category: 'new', type: 'Requirement', key: 'SRS-0041', title: 'Audit log for report exports', workItemId: null, matchedBy: null, parent: 'row 1', parentRow: 'r0', error: null, note: null,
    changes: [
      { field: 'System.Title', name: 'Title', kind: 'set', before: '', after: 'Audit log for report exports', write: true },
      { field: 'Custom.SRSID', name: 'SRS ID', kind: 'set', before: '', after: 'SRS-0041', write: true },
      { field: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', kind: 'set', before: '', after: 'Every export records the user, time and file name in the audit log.', write: true },
      { field: 'System.Parent', name: 'Parent', kind: 'set', before: '', after: 'row 1', write: true },
    ],
  },
  {
    rowKey: 'r2', fp: '3734:12', category: 'changed', type: 'Requirement', key: 'SRS-0005', title: 'Sign in with company account', workItemId: 3734, matchedBy: 'key', parent: null, parentRow: null, error: null, note: null,
    changes: [
      { field: 'System.Title', name: 'Title', kind: 'same', before: 'Sign in with company account', after: 'Sign in with company account', write: false },
      { field: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', kind: 'fill', before: '', after: 'Given a user with a company account\nWhen they choose Sign in with Microsoft\nThen they are signed in without a separate password', write: true },
    ],
  },
  {
    rowKey: 'r3', fp: '3741:8', category: 'conflict', type: 'Requirement', key: 'SRS-0012', title: 'Measure Cobb angle automatically', workItemId: 3741, matchedBy: 'key', parent: null, parentRow: null, error: null, note: null,
    changes: [
      { field: 'Custom.SoftwareRequirementSpecification', name: 'Software Requirement Specification', kind: 'conflict', before: 'The system shall measure the Cobb angle from the X-ray image.', after: 'The system shall measure the Cobb angle from the X-ray image within ±2° of a clinician\'s manual measurement.', write: false },
      { field: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', kind: 'fill', before: '', after: 'Measured on the validation set, 95% of angles are within ±2° of the reference.', write: true },
    ],
  },
  {
    rowKey: 'r4', fp: '3750:4', category: 'same', type: 'Requirement', key: 'SRS-0013', title: 'Show measurement overlay', workItemId: 3750, matchedBy: 'key', parent: null, parentRow: null, error: null, note: null,
    changes: [{ field: 'System.Title', name: 'Title', kind: 'same', before: 'Show measurement overlay', after: 'Show measurement overlay', write: false }],
  },
  {
    rowKey: 'r5', fp: 'error:x', category: 'error', type: 'Requirement', key: 'SRS-0050', title: 'Dark mode for the viewer', workItemId: null, matchedBy: null, parent: null, parentRow: null,
    error: '"Requirement" has no field "User Acceptance Criteria". Did you mean: Acceptance Criteria?', note: null, changes: [],
  },
  {
    rowKey: 'r6', fp: '3812:3', category: 'changed', type: 'Test Case', key: 'TC-031', title: 'Export a report to PDF', workItemId: 3812, matchedBy: 'key', parent: null, parentRow: null, error: null, note: null,
    changes: [
      { field: 'Microsoft.VSTS.TCM.Steps', name: 'Steps', kind: 'fill', before: '', after: '1. Open a completed scan\n2. Choose Export → PDF\n   Expected: A PDF with the report and images is saved', write: true },
      { field: 'Tests', name: 'Tests', kind: 'add', before: 'SRS-0012', after: 'SRS-0012, SRS-0040', write: true },
    ],
  },
  {
    rowKey: 'r7', fp: '3815:9', category: 'conflict', type: 'Test Case', key: 'TC-032', title: 'Sign in with a company account', workItemId: 3815, matchedBy: 'key', parent: null, parentRow: null, error: null, note: null,
    changes: [
      { field: 'Microsoft.VSTS.TCM.Steps', name: 'Steps', kind: 'conflict', before: '1. (shared steps #812)\n2. Check the home page shows the user name', after: '1. Choose Sign in with Microsoft\n   Expected: Signed in without a password', write: false, locked: 'Uses shared steps, so its steps are kept; change them in Boards.' },
    ],
  },
  {
    rowKey: 'w3690', fp: 'rm:3690:6', category: 'missing', type: 'Requirement', key: 'SRS-0002', title: 'Print report on hospital printer', workItemId: 3690, matchedBy: null, parent: null, parentRow: null, error: null, note: null,
    changes: [
      { field: 'System.State', name: 'State', kind: 'set', before: 'Active', after: 'Removed', write: true },
      { field: 'System.Tags', name: 'Tags', kind: 'set', before: 'Reporting', after: 'Reporting; Removed by import', write: true },
    ],
  },
]

const summary = { create: 2, update: 4, skip: 1, remove: 1, error: 1, rowsWithConflicts: 2 }

let imports: ImportInfo[] = [
  { id: 'import-demo', org: 'demo-org', project: 'Contoso Mobile', source: 'docs/SRS.md', created: Date.now() - 4 * 60_000, status: 'pending', summary, rows: 8, removeMissing: true, result: null, finished: null },
]

const later = <T,>(v: T) => new Promise<T>((resolve) => setTimeout(() => resolve(v), 250))

export const demoImportCalls = {
  list: () => later(imports.map((i) => ({ ...i }))),
  review: (id: string): Promise<ImportReview> => {
    const info = imports.find((i) => i.id === id)
    if (!info) return Promise.reject(new Error('No such import.'))
    return later({ project: info.project, summary, removalsHeld: null, rows: ROWS, import: info })
  },
  apply: (id: string, picks: ImportPick[]): Promise<ImportResult> => {
    const picked = new Set(picks.map((p) => p.rowKey))
    let next = 3800
    const results = ROWS.map((r): ImportResultRow => {
      const base = { rowKey: r.rowKey, row: null, key: r.key, title: r.title, action: r.category, workItemId: r.workItemId }
      if (!picked.has(r.rowKey)) return { ...base, ok: true, skipped: 'not picked' }
      if (r.category === 'error') return { ...base, ok: false, error: r.error ?? 'Error' }
      return { ...base, ok: true, workItemId: r.workItemId ?? next++ }
    })
    const result: ImportResult = { project: 'Contoso Mobile', done: results.filter((r) => r.ok && !r.skipped).length, failed: results.filter((r) => !r.ok).length, notPicked: results.filter((r) => r.skipped).length, unchanged: 0, results }
    imports = imports.map((i) => (i.id === id ? { ...i, status: 'applied', result, finished: Date.now() } : i))
    return later(result)
  },
  discard: (id: string) => {
    imports = imports.map((i) => (i.id === id ? { ...i, status: 'discarded', finished: Date.now() } : i))
    return later(undefined)
  },
}
