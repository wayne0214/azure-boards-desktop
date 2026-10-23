import { describe, expect, it } from 'vitest'
import type { CaseInfo } from './report'
import type { TpPlan, TpPoint, TpResult, TpRun, TpSuite } from './types'
import { buildVersionReport, caseStatus, versionReportCsv, versionReportHtml } from './versionReport'

const suites: TpSuite[] = [
  { id: 1, name: 'AEON – V&V', suiteType: 'staticTestSuite' },
  { id: 2, name: 'Verification', parentId: 1, suiteType: 'staticTestSuite' },
  { id: 3, name: 'SRS-10 : Sign in', parentId: 2, suiteType: 'requirementTestSuite', requirementId: 50 },
  { id: 4, name: 'Smoke', parentId: 1, suiteType: 'dynamicTestSuite', tag: 'Smoke' },
]
const pt = (id: number, suiteId: number, testCaseId: number, cfg: string): TpPoint => ({ id, suiteId, testCaseId, testCaseTitle: `TC ${testCaseId}`, configurationId: cfg === 'macOS' ? 1 : 2, configurationName: cfg, outcome: 'passed', isAutomated: false })
// Test case 100 sits in both Sign in and Smoke.
const points = [pt(11, 3, 100, 'macOS'), pt(12, 3, 100, 'Windows 11'), pt(13, 4, 100, 'macOS'), pt(14, 3, 101, 'macOS')]
const runs: TpRun[] = [{ id: 7, name: 'SDV run 0.4.0', buildNumber: '0.4.0', state: 'Completed', isAutomated: false, totalTests: 3, passedTests: 2, completedDate: '2026-10-20T09:00:00Z' }, { id: 8, name: 'other', buildNumber: '0.3.0', state: 'Completed', isAutomated: false, totalTests: 1, passedTests: 1 }]
const res = (pointId: number, outcome: string): TpResult => ({ runId: 7, resultId: pointId * 10, pointId, outcome, runBy: 'Ann', completedDate: '2026-10-20T09:00:00Z', errorMessage: outcome === 'failed' ? 'Expected visible' : undefined })
const results = new Map([[11, res(11, 'passed')], [12, res(12, 'failed')], [13, res(13, 'passed')]])
const cases = new Map<number, CaseInfo>([[100, { label: 'SDV-0001', srsIds: [50] }], [101, { label: 'SDV-0002', srsIds: [50, 51] }]])
const reqs = new Map([[50, { label: 'SRS-10', title: 'Sign in' }], [51, { label: 'SRS-11', title: 'Sign out' }]])
const base = { version: '0.4.0', suites, points, runs, results, rootSuiteId: 1, cases, reqs, bugsOf: (id: number) => (id === 100 ? [{ id: 900, title: 'Retake hidden on Windows', state: 'Active' }] : []) }

describe('the version report', () => {
  it('lists every point in scope, with the run behind each result', () => {
    const r = buildVersionReport({ ...base, scope: [] })
    expect(r.rows.map((x) => [x.point.id, x.bucket, x.result?.runId])).toEqual([[13, 'passed', 7], [11, 'passed', 7], [12, 'failed', 7], [14, 'notRun', undefined]])
    expect(r.counts).toMatchObject({ total: 4, passed: 2, failed: 1, notRun: 1 })
    expect(r.runs.map((x) => x.id)).toEqual([7])
    expect(r.configurations).toEqual(['Windows 11', 'macOS'])
    expect(r.failures.map((f) => [f.point.id, f.bugs.map((b) => b.id)])).toEqual([[12, [900]]])
  })
  it('keeps to the suites the version was started on', () => {
    const r = buildVersionReport({ ...base, scope: [4] })
    expect(r.rows.map((x) => x.point.id)).toEqual([13])
  })
  it('counts requirement coverage once per test case, however many suites hold it', () => {
    const r = buildVersionReport({ ...base, scope: [] })
    expect(r.coverage.map((q) => [q.label, q.cases.map((c) => `${c.label}:${c.status}`), q.verified])).toEqual([
      ['SRS-10', ['SDV-0001:failed', 'SDV-0002:notRun'], false],
      ['SRS-11', ['SDV-0002:notRun'], false],
    ])
    expect(r.unverified).toHaveLength(2)
  })
  it('judges a test case by all its points', () => {
    expect(caseStatus(['passed', 'passed', 'na'])).toBe('passed')
    expect(caseStatus(['passed', 'notRun'])).toBe('partial')
    expect(caseStatus(['passed', 'blocked'])).toBe('blocked')
    expect(caseStatus(['notRun'])).toBe('notRun')
  })
  it('exports with run IDs, escaped names and a sign-off block', () => {
    const plan: TpPlan = { id: 3, name: 'AEON <V&V>', state: 'Active', iteration: '', areaPath: '', rootSuiteId: 1 }
    const r = buildVersionReport({ ...base, scope: [] })
    const html = versionReportHtml(plan, r, cases, '2026-10-23', 'Wayne')
    expect(html).toContain('AEON &lt;V&amp;V&gt; (ID 3)')
    expect(html).toContain('<td class="c-id">7</td>')
    expect(html).toContain('Not run on this version')
    expect(html).toContain('<td>Approved by</td>')
    expect(html).toContain('#900 Retake hidden on Windows (Active)')
    const csv = versionReportCsv(r, cases).split('\r\n')
    expect(csv[0]).toBe('Version,Test case,ID,Title,Suite,Configuration,Outcome,Tested by,Date,Run ID,Error')
    expect(csv[3]).toBe('0.4.0,100,SDV-0001,TC 100,SRS-10 : Sign in,Windows 11,Failed,Ann,2026-10-20,7,Expected visible')
  })
})
