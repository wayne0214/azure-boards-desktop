import { csvEscape } from '../format'
import { countPoints, esc, pct, rates, suiteAndBelow, type CaseInfo, type Counts, type ReqInfo } from './report'
import { BUCKET_LABEL, bucketOf, type Bucket, type TpPlan, type TpPoint, type TpResult, type TpRun, type TpSuite } from './types'

/**
 * The record of one version: every point in scope with its result on that version (or "not run"),
 * the runs behind them, failures with their bugs, and requirement coverage counted per test case.
 * Exported to Word, it is the frozen record for the release file; Azure DevOps keeps the runs it cites.
 */

export interface BugRef { id: number; title: string; state: string }

export interface VersionRow {
  point: TpPoint
  suite: string
  /** The point's latest result on the version; none means not run on it. */
  result?: TpResult
  bucket: Bucket
}

export type CaseStatus = 'passed' | 'failed' | 'blocked' | 'notRun' | 'partial'

export interface CoverageRow {
  id: number
  label: string
  title: string
  cases: { id: number; label: string; status: CaseStatus }[]
  verified: boolean
}

export interface VersionReport {
  version: string
  counts: Counts
  rows: VersionRow[]
  runs: TpRun[]
  configurations: string[]
  failures: (VersionRow & { bugs: BugRef[] })[]
  coverage: CoverageRow[]
  /** Requirements in scope with no passing test case on this version. */
  unverified: CoverageRow[]
}

/** One status per test case from all its points in scope, whichever suites they sit in. */
export function caseStatus(buckets: Bucket[]): CaseStatus {
  const counted = buckets.filter((b) => b !== 'na')
  if (counted.includes('failed')) return 'failed'
  if (counted.includes('blocked')) return 'blocked'
  if (counted.length && counted.every((b) => b === 'passed')) return 'passed'
  if (counted.every((b) => b === 'notRun')) return 'notRun'
  return 'partial'
}

export function buildVersionReport(input: {
  version: string
  suites: TpSuite[]
  /** Points as they stand now; their outcome is replaced by the version's results. */
  points: TpPoint[]
  runs: TpRun[]
  results: Map<number, TpResult>
  /** Suites the version was started on; empty means the whole plan. */
  scope: number[]
  rootSuiteId: number
  cases: Map<number, CaseInfo>
  reqs: Map<number, ReqInfo>
  bugsOf: (testCaseId: number) => BugRef[]
}): VersionReport {
  const { version, suites, results, cases, reqs } = input
  const inScope = new Set((input.scope.length ? input.scope : [input.rootSuiteId]).flatMap((id) => suiteAndBelow(suites, id)))
  const names = new Map(suites.map((s) => [s.id, s.name]))
  const label = (id: number) => cases.get(id)?.label ?? `#${id}`
  const rows: VersionRow[] = input.points
    .filter((p) => inScope.has(p.suiteId))
    .map((point) => {
      const result = results.get(point.id)
      return { point, suite: names.get(point.suiteId) ?? '', result, bucket: bucketOf(result?.outcome ?? 'unspecified') }
    })
    .sort((a, b) => label(a.point.testCaseId).localeCompare(label(b.point.testCaseId), undefined, { numeric: true }) || a.point.configurationName.localeCompare(b.point.configurationName) || a.suite.localeCompare(b.suite))
  const usedRuns = new Set(rows.flatMap((r) => (r.result ? [r.result.runId] : [])))
  const byCase = new Map<number, Bucket[]>()
  for (const r of rows) byCase.set(r.point.testCaseId, [...(byCase.get(r.point.testCaseId) ?? []), r.bucket])
  const reqIds = [...new Set([...byCase.keys()].flatMap((id) => cases.get(id)?.srsIds ?? []))]
  const coverage: CoverageRow[] = reqIds.map((rid) => {
    const list = [...byCase.entries()].filter(([id]) => (cases.get(id)?.srsIds ?? []).includes(rid)).map(([id, bs]) => ({ id, label: label(id), status: caseStatus(bs) }))
    list.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    return { id: rid, label: reqs.get(rid)?.label ?? `#${rid}`, title: reqs.get(rid)?.title ?? '', cases: list, verified: list.length > 0 && list.every((c) => c.status === 'passed') }
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  return {
    version,
    counts: countPoints(rows.map((r) => ({ ...r.point, outcome: r.result?.outcome ?? 'unspecified' }))),
    rows,
    runs: input.runs.filter((r) => usedRuns.has(r.id)).sort((a, b) => a.id - b.id),
    configurations: [...new Set(rows.filter((r) => r.result).map((r) => r.point.configurationName).filter(Boolean))].sort(),
    failures: rows.filter((r) => r.bucket === 'failed' || r.bucket === 'blocked').map((r) => ({ ...r, bugs: input.bugsOf(r.point.testCaseId) })),
    coverage,
    unverified: coverage.filter((c) => !c.verified),
  }
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : '')
const CASE_LABEL: Record<CaseStatus, string> = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', notRun: 'Not run', partial: 'Partly run' }

export function versionReportHtml(plan: TpPlan, r: VersionReport, cases: Map<number, CaseInfo>, generated: string, by: string): string {
  const c = r.counts
  const rt = rates(c)
  const label = (testCaseId: number) => cases.get(testCaseId)?.label ?? `#${testCaseId}`
  const summary = `<p>Plan: ${esc(plan.name)} (ID ${plan.id}) · Version: <b>${esc(r.version)}</b> · Generated ${esc(generated)} by ${esc(by)}</p>
<table><tbody><tr><td>Test points in scope</td><td>${c.total}</td></tr><tr><td>Passed</td><td>${c.passed}</td></tr><tr><td>Failed</td><td>${c.failed}</td></tr><tr><td>Blocked</td><td>${c.blocked}</td></tr><tr><td>Not run on this version</td><td>${c.notRun}</td></tr><tr><td>Not applicable</td><td>${c.na}</td></tr><tr><td>Run</td><td>${pct(rt.run)}</td></tr><tr><td>Pass rate</td><td>${pct(rt.pass)}</td></tr><tr><td>Configurations covered</td><td>${esc(r.configurations.join(', ') || 'None')}</td></tr><tr><td>Requirements verified</td><td>${r.coverage.length - r.unverified.length} of ${r.coverage.length}</td></tr></tbody></table>`
  const runs = `<h2>Test runs</h2>${r.runs.length ? `<table><thead><tr><th>Run ID</th><th>Name</th><th>Type</th><th>Completed</th><th>Results</th><th>Passed</th></tr></thead><tbody>${r.runs.map((x) => `<tr><td class="c-id">${x.id}</td><td>${esc(x.name)}</td><td>${x.isAutomated ? 'Automated' : 'Manual'}</td><td>${esc(day(x.completedDate))}</td><td>${x.totalTests}</td><td>${x.passedTests}</td></tr>`).join('')}</tbody></table>` : '<p>No runs on this version.</p>'}`
  const coverage = r.coverage.length
    ? `<h2>Requirement coverage</h2><table><thead><tr><th>Requirement</th><th>Title</th><th>Test cases</th><th>Verified</th></tr></thead><tbody>${r.coverage.map((q) => `<tr><td class="c-id">${esc(q.label)}</td><td>${esc(q.title)}</td><td>${q.cases.map((x) => `${esc(x.label)}: ${CASE_LABEL[x.status]}`).join('<br>')}</td><td>${q.verified ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table>`
    : ''
  const failures = `<h2>Failed and blocked</h2>${r.failures.length ? `<table><thead><tr><th>Test case</th><th>Configuration</th><th>Outcome</th><th>Run ID</th><th>Error</th><th>Bugs</th></tr></thead><tbody>${r.failures.map((f) => `<tr><td class="c-id">${esc(label(f.point.testCaseId))} ${esc(f.point.testCaseTitle)}</td><td>${esc(f.point.configurationName)}</td><td>${BUCKET_LABEL[f.bucket]}</td><td>${f.result?.runId ?? ''}</td><td>${esc(f.result?.errorMessage ?? '')}</td><td>${f.bugs.map((b) => `#${b.id} ${esc(b.title)} (${esc(b.state)})`).join('<br>') || 'None filed'}</td></tr>`).join('')}</tbody></table>` : '<p>Nothing failed or was blocked on this version.</p>'}`
  const results = `<h2>Results</h2><table><thead><tr><th>Test case</th><th>Title</th><th>Suite</th><th>Configuration</th><th>Outcome</th><th>Tested by</th><th>Date</th><th>Run ID</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td class="c-id">${esc(label(x.point.testCaseId))}</td><td>${esc(x.point.testCaseTitle)}</td><td>${esc(x.suite)}</td><td>${esc(x.point.configurationName)}</td><td>${x.result ? BUCKET_LABEL[x.bucket] : 'Not run on this version'}</td><td>${esc(x.result?.runBy ?? '')}</td><td>${esc(day(x.result?.completedDate))}</td><td>${x.result?.runId ?? ''}</td></tr>`).join('')}</tbody></table>`
  const signoff = `<h2>Sign-off</h2><table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>${['Tested by', 'Reviewed by', 'Approved by'].map((role) => `<tr><td>${role}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</tbody></table>`
  return [summary, runs, coverage, failures, results, signoff].join('')
}

export function versionReportCsv(r: VersionReport, cases: Map<number, CaseInfo>): string {
  const head = ['Version', 'Test case', 'ID', 'Title', 'Suite', 'Configuration', 'Outcome', 'Tested by', 'Date', 'Run ID', 'Error']
  const rows = r.rows.map((x) => [
    r.version, x.point.testCaseId, cases.get(x.point.testCaseId)?.label ?? '', x.point.testCaseTitle, x.suite, x.point.configurationName,
    x.result ? BUCKET_LABEL[x.bucket] : 'Not run', x.result?.runBy ?? '', day(x.result?.completedDate), x.result?.runId ?? '', x.result?.errorMessage ?? '',
  ])
  return [head, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
}
