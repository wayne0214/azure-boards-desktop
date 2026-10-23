import { csvEscape } from '../format'
import { BUCKET_LABEL, bucketOf, type Bucket, type TpPlan, type TpPoint, type TpSuite } from './types'

/** Counts and summaries over a plan's test points, for the Report tab and its exports. */

export type Counts = Record<Bucket, number> & { total: number }

export const emptyCounts = (): Counts => ({ passed: 0, failed: 0, blocked: 0, notRun: 0, na: 0, total: 0 })

export function countPoints(points: TpPoint[]): Counts {
  const c = emptyCounts()
  for (const p of points) { c[bucketOf(p.outcome)]++; c.total++ }
  return c
}

/** Share of points that count (not N/A) that have run, and that passed. */
export function rates(c: Counts): { run: number; pass: number } {
  const counted = c.total - c.na
  if (!counted) return { run: 0, pass: 0 }
  return { run: (counted - c.notRun) / counted, pass: c.passed / counted }
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`

export interface Group { key: string; label: string; counts: Counts }

function groupBy(points: TpPoint[], keyOf: (p: TpPoint) => [string, string][]): Group[] {
  const map = new Map<string, { label: string; pts: TpPoint[] }>()
  for (const p of points) {
    for (const [key, label] of keyOf(p)) {
      const g = map.get(key) ?? { label, pts: [] }
      g.pts.push(p)
      map.set(key, g)
    }
  }
  return [...map.entries()].map(([key, g]) => ({ key, label: g.label, counts: countPoints(g.pts) }))
}

/** A suite and every suite under it. */
export function suiteAndBelow(suites: TpSuite[], id: number): number[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const x of suites) if (x.parentId === out[i] && !out.includes(x.id)) out.push(x.id)
  return out
}

/** Each suite's own points plus those of the suites under it. */
export function suiteTotals(suites: TpSuite[], points: TpPoint[]): Map<number, Counts> {
  const children = new Map<number, number[]>()
  for (const s of suites) if (s.parentId != null) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s.id])
  const own = new Map<number, TpPoint[]>()
  for (const p of points) own.set(p.suiteId, [...(own.get(p.suiteId) ?? []), p])
  const out = new Map<number, Counts>()
  const total = (id: number, seen: Set<number>): Counts => {
    const hit = out.get(id)
    if (hit) return hit
    const c = countPoints(own.get(id) ?? [])
    for (const k of children.get(id) ?? []) {
      if (seen.has(k)) continue
      const sub = total(k, new Set([...seen, k]))
      for (const b of ['passed', 'failed', 'blocked', 'notRun', 'na', 'total'] as const) c[b] += sub[b]
    }
    out.set(id, c)
    return c
  }
  for (const s of suites) total(s.id, new Set([s.id]))
  return out
}

export interface CaseInfo {
  /** The test case's SDV ID, or its number. */
  label: string
  srsIds: number[]
}

export interface ReqInfo { label: string; title: string }

export type ReqStatus = 'passed' | 'failed' | 'blocked' | 'inProgress' | 'notRun'

export interface ReqRow { id: number; label: string; title: string; counts: Counts; status: ReqStatus }

/** Requirements the plan's test cases verify, judged by all their points in the plan. */
export function requirementRows(points: TpPoint[], cases: Map<number, CaseInfo>, reqs: Map<number, ReqInfo>): ReqRow[] {
  const groups = groupBy(points, (p) => (cases.get(p.testCaseId)?.srsIds ?? []).map((id) => [String(id), reqs.get(id)?.label ?? `#${id}`]))
  return groups.map((g) => {
    const c = g.counts
    const counted = c.total - c.na
    const status: ReqStatus = c.failed ? 'failed' : c.blocked ? 'blocked' : counted && c.passed === counted ? 'passed' : c.notRun === counted ? 'notRun' : 'inProgress'
    const id = Number(g.key)
    return { id, label: g.label, title: reqs.get(id)?.title ?? '', counts: c, status }
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export interface PlanReport {
  counts: Counts
  bySuite: Group[]
  byConfiguration: Group[]
  byTester: Group[]
  requirements: ReqRow[]
  failures: TpPoint[]
}

export function buildReport(suites: TpSuite[], points: TpPoint[], cases: Map<number, CaseInfo>, reqs: Map<number, ReqInfo>): PlanReport {
  const names = new Map(suites.map((s) => [s.id, s.name]))
  return {
    counts: countPoints(points),
    bySuite: groupBy(points, (p) => [[String(p.suiteId), names.get(p.suiteId) ?? `Suite ${p.suiteId}`]]),
    byConfiguration: groupBy(points, (p) => [[String(p.configurationId), p.configurationName || 'No configuration']]),
    byTester: groupBy(points, (p) => [[p.tester?.id ?? '', p.tester?.displayName ?? 'Unassigned']]),
    requirements: requirementRows(points, cases, reqs),
    failures: points.filter((p) => ['failed', 'blocked'].includes(bucketOf(p.outcome))),
  }
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : '')

export function pointsCsv(suites: TpSuite[], points: TpPoint[], cases: Map<number, CaseInfo>, reqs: Map<number, ReqInfo>): string {
  const names = new Map(suites.map((s) => [s.id, s.name]))
  const head = ['Suite', 'Test case', 'ID', 'Title', 'Configuration', 'Tester', 'Outcome', 'Automated', 'Last run', 'Run by', 'Requirements']
  const rows = points.map((p) => [
    names.get(p.suiteId) ?? '', p.testCaseId, cases.get(p.testCaseId)?.label ?? '', p.testCaseTitle, p.configurationName,
    p.tester?.displayName ?? '', BUCKET_LABEL[bucketOf(p.outcome)], p.isAutomated ? 'Yes' : 'No', day(p.lastRunDate), p.lastRunBy ?? '',
    (cases.get(p.testCaseId)?.srsIds ?? []).map((id) => reqs.get(id)?.label ?? `#${id}`).join(', '),
  ])
  return [head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')
}

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function countsTable(title: string, groups: Group[]): string {
  if (!groups.length) return ''
  const rows = groups.map((g) => {
    const r = rates(g.counts)
    return `<tr><td>${esc(g.label)}</td><td>${g.counts.total}</td><td>${g.counts.passed}</td><td>${g.counts.failed}</td><td>${g.counts.blocked}</td><td>${g.counts.notRun}</td><td>${pct(r.pass)}</td></tr>`
  }).join('')
  return `<h2>${esc(title)}</h2><table><thead><tr><th>${esc(title.replace(/^By /, ''))}</th><th>Points</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Not run</th><th>Pass rate</th></tr></thead><tbody>${rows}</tbody></table>`
}

const REQ_LABEL: Record<ReqStatus, string> = { passed: 'Verified', failed: 'Failing', blocked: 'Blocked', inProgress: 'In progress', notRun: 'Not run' }
export const reqStatusLabel = (s: ReqStatus): string => REQ_LABEL[s]

/** The report as an HTML body, for Word or a web page. */
export function reportHtml(plan: TpPlan, report: PlanReport, cases: Map<number, CaseInfo>, generated: string): string {
  const c = report.counts
  const r = rates(c)
  const summary = `<p>${esc(plan.iteration)} · generated ${esc(generated)}</p>
<table><tbody><tr><td>Test points</td><td>${c.total}</td></tr><tr><td>Passed</td><td>${c.passed}</td></tr><tr><td>Failed</td><td>${c.failed}</td></tr><tr><td>Blocked</td><td>${c.blocked}</td></tr><tr><td>Not run</td><td>${c.notRun}</td></tr><tr><td>Not applicable</td><td>${c.na}</td></tr><tr><td>Run</td><td>${pct(r.run)}</td></tr><tr><td>Pass rate</td><td>${pct(r.pass)}</td></tr></tbody></table>`
  const reqs = report.requirements.length
    ? `<h2>Requirements</h2><table><thead><tr><th>Requirement</th><th>Title</th><th>Points</th><th>Passed</th><th>Status</th></tr></thead><tbody>${report.requirements.map((q) => `<tr><td class="c-id">${esc(q.label)}</td><td>${esc(q.title)}</td><td>${q.counts.total}</td><td>${q.counts.passed}</td><td>${REQ_LABEL[q.status]}</td></tr>`).join('')}</tbody></table>`
    : ''
  const failures = report.failures.length
    ? `<h2>Failed and blocked</h2><table><thead><tr><th>Test case</th><th>Title</th><th>Configuration</th><th>Outcome</th><th>Last run</th></tr></thead><tbody>${report.failures.map((p) => `<tr><td class="c-id">${esc(cases.get(p.testCaseId)?.label ?? `#${p.testCaseId}`)}</td><td>${esc(p.testCaseTitle)}</td><td>${esc(p.configurationName)}</td><td>${BUCKET_LABEL[bucketOf(p.outcome)]}</td><td>${esc(day(p.lastRunDate))} ${esc(p.lastRunBy ?? '')}</td></tr>`).join('')}</tbody></table>`
    : ''
  return [summary, countsTable('By suite', report.bySuite), countsTable('By configuration', report.byConfiguration), countsTable('By tester', report.byTester), reqs, failures].join('')
}
