import { describe, expect, it } from 'vitest'
import { buildReport, countPoints, pointsCsv, rates, reportHtml, requirementRows, suiteTotals, type CaseInfo } from './report'
import { bucketOf, releaseOf, type TpPoint, type TpSuite } from './types'

const pt = (id: number, suiteId: number, testCaseId: number, outcome: string, cfg = 1): TpPoint => ({
  id, suiteId, testCaseId, testCaseTitle: `TC ${testCaseId}`, configurationId: cfg, configurationName: cfg === 1 ? 'macOS' : 'Windows 11', outcome, isAutomated: false,
})
const suites: TpSuite[] = [
  { id: 1, name: 'Release 1.2', suiteType: 'staticTestSuite' },
  { id: 2, name: 'Login', parentId: 1, suiteType: 'requirementTestSuite', requirementId: 50 },
  { id: 3, name: 'Smoke', parentId: 1, suiteType: 'staticTestSuite' },
  { id: 4, name: 'Smoke / Windows', parentId: 3, suiteType: 'staticTestSuite' },
]
const points = [pt(1, 2, 100, 'passed'), pt(2, 2, 100, 'failed', 2), pt(3, 3, 101, 'unspecified'), pt(4, 4, 102, 'blocked'), pt(5, 4, 103, 'notApplicable')]
const cases = new Map<number, CaseInfo>([[100, { label: 'SDV-0001', srsIds: [50] }], [101, { label: 'SDV-0002', srsIds: [50, 51] }], [102, { label: 'SDV-0003', srsIds: [52] }], [103, { label: '#103', srsIds: [] }]])
const reqs = new Map([[50, { label: 'SRS-10', title: 'Sign in' }], [51, { label: 'SRS-11', title: 'Sign out' }], [52, { label: 'SRS-12', title: 'Export' }]])

describe('outcomes', () => {
  it('fall into five buckets', () => {
    expect(['passed', 'failed', 'timeout', 'blocked', 'notApplicable', 'unspecified', 'none', 'notExecuted', 'inProgress'].map(bucketOf))
      .toEqual(['passed', 'failed', 'failed', 'blocked', 'na', 'notRun', 'notRun', 'notRun', 'notRun'])
  })
  it('give run and pass rates that leave N/A out', () => {
    const c = countPoints(points)
    expect(c).toEqual({ passed: 1, failed: 1, blocked: 1, notRun: 1, na: 1, total: 5 })
    expect(rates(c)).toEqual({ run: 0.75, pass: 0.25 })
    expect(rates(countPoints([]))).toEqual({ run: 0, pass: 0 })
  })
})

describe('suite totals', () => {
  it('include the suites below', () => {
    const t = suiteTotals(suites, points)
    expect(t.get(1)!.total).toBe(5)
    expect(t.get(3)).toMatchObject({ total: 3, notRun: 1, blocked: 1, na: 1 })
    expect(t.get(4)!.total).toBe(2)
  })
  it('survive a suite listed as its own ancestor', () => {
    const loop: TpSuite[] = [{ id: 1, name: 'a', parentId: 2, suiteType: 'staticTestSuite' }, { id: 2, name: 'b', parentId: 1, suiteType: 'staticTestSuite' }]
    expect(suiteTotals(loop, [pt(1, 1, 1, 'passed')]).get(1)!.total).toBe(1)
  })
})

describe('requirements in the plan', () => {
  it('are verified only when every counted point passed', () => {
    const rows = requirementRows(points, cases, reqs)
    expect(rows.map((r) => [r.label, r.status])).toEqual([['SRS-10', 'failed'], ['SRS-11', 'notRun'], ['SRS-12', 'blocked']])
    const ok = requirementRows([pt(1, 2, 100, 'passed'), pt(2, 2, 100, 'passed', 2)], cases, reqs)
    expect(ok[0].status).toBe('passed')
    expect(requirementRows([pt(1, 2, 100, 'passed'), pt(2, 2, 100, 'unspecified', 2)], cases, reqs)[0].status).toBe('inProgress')
  })
})

describe('exports', () => {
  const report = buildReport(suites, points, cases, reqs)
  it('group by suite, configuration and tester, and list what failed', () => {
    expect(report.bySuite.map((g) => [g.label, g.counts.total])).toEqual([['Login', 2], ['Smoke', 1], ['Smoke / Windows', 2]])
    expect(report.byConfiguration.map((g) => g.label)).toEqual(['macOS', 'Windows 11'])
    expect(report.byTester.map((g) => g.label)).toEqual(['Unassigned'])
    expect(report.failures.map((p) => p.id)).toEqual([2, 4])
  })
  it('write a CSV row per point with its requirements', () => {
    const lines = pointsCsv(suites, points, cases, reqs).split('\r\n')
    expect(lines[0]).toBe('Suite,Test case,ID,Title,Configuration,Tester,Outcome,Automated,Last run,Run by,Requirements')
    expect(lines[3]).toBe('Smoke,101,SDV-0002,TC 101,macOS,,Not run,No,,,"SRS-10, SRS-11"')
  })
  it('write an HTML report with the summary and escaped names', () => {
    const html = reportHtml({ id: 1, name: 'R', state: 'Active', iteration: 'P\\<S1>', areaPath: 'P', rootSuiteId: 1 }, report, cases, '2026-10-23')
    expect(html).toContain('P\\&lt;S1&gt;')
    expect(html).toContain('<h2>By configuration</h2>')
    expect(html).toContain('<td>Pass rate</td><td>25%</td>')
  })
})

describe('plan names', () => {
  it('give the release that Run mode in Test Cases uses', () => {
    expect(releaseOf({ name: 'Release 2.1.0' })).toBe('2.1.0')
    expect(releaseOf({ name: 'release v3 RC1' })).toBe('v3 RC1')
    expect(releaseOf({ name: 'Sprint 24 regression' })).toBe('Sprint 24 regression')
  })
})
