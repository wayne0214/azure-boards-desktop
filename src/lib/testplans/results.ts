import type { PointResultInput, ResultOutcome, TpConfiguration, TpPoint } from './types'

/** Automated test results read from a Playwright JSON report or a JUnit XML file, and matched to test points. */

export type AutoOutcome = 'passed' | 'failed' | 'skipped' | 'flaky'

export interface AutoResult {
  /** "describe › test", as the report names it. */
  fullName: string
  file?: string
  /** Playwright project, or the JUnit suite's host; matched to a configuration by name. */
  project?: string
  outcome: AutoOutcome
  durationMs: number
  error?: string
  stack?: string
  /**
   * Test case references found in the title, tags and annotations: "id:1234" or "key:SDV-0012".
   * "num:2" (a bare [2]) and "word:UTF-8" (an ID-like word outside brackets) may be ordinary text, so they count only if they name something real.
   */
  refs: string[]
}

export type ReportFormat = 'playwright' | 'junit'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g
const clean = (s: string | undefined | null): string | undefined => {
  const t = (s ?? '').replace(ANSI, '').trim()
  return t || undefined
}

/** References written into a title or tag: [1234], [TC-1234], @TC1234, TC-1234, or an ID like SDV-0012. */
export function refsIn(text: string): string[] {
  const out: string[] = []
  const add = (r: string) => { if (!out.includes(r)) out.push(r) }
  for (const m of text.matchAll(/\[\s*tc[-_: ]?(\d+)\s*\]|(?:^|[\s@(])tc[-_:]?(\d+)\b/gi)) add(`id:${m[1] ?? m[2]}`)
  // [1234] is the usual way to name a test case; a short [2] may just be a parameter index.
  for (const m of text.matchAll(/\[\s*(\d+)\s*\]/g)) add(`${m[1].length >= 3 ? 'id' : 'num'}:${m[1]}`)
  // Prefixed IDs such as SDV-0012; TC- is a test case number, handled above. Only [..] or @.. is sure to mean an ID.
  for (const m of text.matchAll(/(^|[\s[@(])([A-Za-z]{2,}-\d+)\b/g)) if (!/^tc-/i.test(m[2])) add(`${m[1] === '[' || m[1] === '@' ? 'key' : 'word'}:${m[2].toUpperCase()}`)
  return out.filter((r) => !(r.startsWith('num:') && out.includes(`id:${r.slice(4)}`)))
}

const ANNOTATION_TYPES = new Set(['testcase', 'test case', 'test_case', 'tc', 'testcaseid', 'azure', 'ado'])

/** References in an annotation such as { type: 'TestCase', description: '1234, 1240' }. */
export function refsInAnnotation(type: string, description: string | undefined): string[] {
  if (!ANNOTATION_TYPES.has(type.trim().toLowerCase())) return []
  return (description ?? '').split(/[\s,;]+/).filter(Boolean).flatMap((d) => (/^\d+$/.test(d) ? [`id:${d}`] : refsIn(d)))
}

const uniq = (xs: string[]) => [...new Set(xs)]

export function detectFormat(text: string): ReportFormat | null {
  const t = text.trimStart()
  if (t.startsWith('<')) return /<testsuites?\b|<testcase\b/.test(t) ? 'junit' : null
  if (t.startsWith('{')) {
    try { const j = JSON.parse(t) as { suites?: unknown }; return Array.isArray(j.suites) ? 'playwright' : null } catch { return null }
  }
  return null
}

export function parseReport(text: string): { format: ReportFormat; results: AutoResult[] } {
  const format = detectFormat(text)
  if (format === 'playwright') return { format, results: parsePlaywright(text) }
  if (format === 'junit') return { format, results: parseJunit(text) }
  throw new Error('This is not a Playwright JSON report or a JUnit XML file.')
}

interface PwResult { status?: string; duration?: number; error?: { message?: string; stack?: string }; errors?: { message?: string }[] }
interface PwTest { projectName?: string; status?: string; annotations?: { type: string; description?: string }[]; results?: PwResult[] }
interface PwSpec { title: string; file?: string; tags?: string[]; tests?: PwTest[] }
interface PwSuite { title: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }

export function parsePlaywright(text: string): AutoResult[] {
  const report = JSON.parse(text) as { suites?: PwSuite[] }
  const out: AutoResult[] = []
  const walk = (suite: PwSuite, path: string[], file: string | undefined) => {
    // The top suite of each file is titled with the file name; describe blocks below it are part of the name.
    const f = file ?? suite.file ?? suite.title
    const here = file ? [...path, suite.title].filter(Boolean) : path
    for (const spec of suite.specs ?? []) {
      const name = [...here, spec.title].join(' › ')
      const titleRefs = [...refsIn(name), ...(spec.tags ?? []).flatMap((t) => refsIn(t.startsWith('@') ? t : `@${t}`))]
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1]
        const outcome: AutoOutcome = t.status === 'expected' ? 'passed' : t.status === 'flaky' ? 'flaky' : t.status === 'skipped' ? 'skipped' : 'failed'
        const err = last?.error ?? last?.errors?.[0]
        out.push({
          fullName: name,
          file: spec.file ?? f,
          project: t.projectName || undefined,
          outcome,
          durationMs: Math.round((t.results ?? []).reduce((n, r) => n + (r.duration ?? 0), 0)),
          error: outcome === 'failed' ? clean(err?.message) : undefined,
          stack: outcome === 'failed' ? clean((err as PwResult['error'])?.stack) : undefined,
          refs: uniq([...titleRefs, ...(t.annotations ?? []).flatMap((a) => refsInAnnotation(a.type, a.description))]),
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child, here, f)
  }
  for (const s of report.suites ?? []) walk(s, [], undefined)
  return out
}

export function parseJunit(text: string): AutoResult[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The XML file could not be read.')
  const out: AutoResult[] = []
  for (const tc of Array.from(doc.getElementsByTagName('testcase'))) {
    const suite = tc.parentElement?.tagName === 'testsuite' ? tc.parentElement : null
    const name = tc.getAttribute('name') ?? ''
    const failure = tc.getElementsByTagName('failure')[0] ?? tc.getElementsByTagName('error')[0]
    const skipped = tc.getElementsByTagName('skipped')[0]
    const props = Array.from(tc.getElementsByTagName('property')).flatMap((p) => refsInAnnotation(p.getAttribute('name') ?? '', p.getAttribute('value') ?? p.textContent ?? ''))
    const body = clean(failure?.textContent)
    out.push({
      fullName: name,
      file: tc.getAttribute('file') ?? suite?.getAttribute('file') ?? tc.getAttribute('classname') ?? undefined,
      project: suite?.getAttribute('hostname') || undefined,
      outcome: failure ? 'failed' : skipped ? 'skipped' : 'passed',
      durationMs: Math.round(Number(tc.getAttribute('time') ?? 0) * 1000) || 0,
      error: failure ? clean(failure.getAttribute('message')) ?? body?.split('\n')[0] : undefined,
      stack: failure ? body : undefined,
      refs: uniq([...refsIn(name), ...props]),
    })
  }
  return out
}

// ----- Matching to points -----

export interface Match {
  result: AutoResult
  /** Points this result reports to; empty when it matched none. */
  pointIds: number[]
  testCaseIds: number[]
  configurationName?: string
  /** Why it matched nothing, or matched only some of what it names. */
  problem?: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The configuration a Playwright project (or JUnit host) names: the same name, or the only one containing it (or contained in it). */
export function configurationByName(project: string | undefined, configs: TpConfiguration[]): TpConfiguration | undefined {
  const p = norm(project ?? '')
  if (!p) return undefined
  const exact = configs.find((c) => norm(c.name) === p)
  if (exact) return exact
  const loose = configs.filter((c) => norm(c.name) && (norm(c.name).includes(p) || p.includes(norm(c.name))))
  return loose.length === 1 ? loose[0] : undefined
}

/** The configuration a result reports to: named by its project, else the one chosen for the file. */
export function configurationFor(project: string | undefined, configs: TpConfiguration[], fallbackId: number | null): TpConfiguration | undefined {
  return configurationByName(project, configs) ?? configs.find((c) => c.id === fallbackId)
}

export function matchResults(results: AutoResult[], points: TpPoint[], configs: TpConfiguration[], keyToId: Map<string, number>, fallbackConfigId: number | null): Match[] {
  return results.map((result) => {
    const inPlan = new Set(points.map((p) => p.testCaseId))
    const sure = result.refs.filter((r) => r.startsWith('id:') || r.startsWith('key:'))
    const ids = uniq(result.refs.map((r) => {
      const v = r.slice(r.indexOf(':') + 1)
      if (r.startsWith('id:')) return v
      if (r.startsWith('num:')) return inPlan.has(Number(v)) ? v : ''
      const id = keyToId.get(v)
      return id ? String(id) : ''
    }).filter(Boolean)).map(Number)
    if (!ids.length) return { result, pointIds: [], testCaseIds: [], problem: sure.length ? `No test case has the ID ${sure.map((r) => r.slice(r.indexOf(':') + 1)).join(', ')}` : 'No test case ID in the title' }
    const named = configurationByName(result.project, configs)
    const cfg = named ?? configs.find((c) => c.id === fallbackConfigId)
    const pointIds: number[] = []
    const missing: string[] = []
    for (const id of ids) {
      const forCase = points.filter((p) => p.testCaseId === id)
      // Unless the project names a configuration, a test case with a single point takes the result whatever it is called.
      const byCfg = cfg ? forCase.filter((p) => p.configurationId === cfg.id) : []
      const hit = byCfg.length ? byCfg : !named && forCase.length === 1 ? forCase : []
      if (hit.length) pointIds.push(...hit.map((p) => p.id))
      else missing.push(!forCase.length ? `#${id} is not in this plan` : `#${id} has no point for ${cfg?.name ?? 'any configuration chosen'}`)
    }
    return { result, pointIds: uniq(pointIds.map(String)).map(Number), testCaseIds: ids, configurationName: cfg?.name, problem: missing.length ? missing.join('; ') : undefined }
  })
}

const RESULT: Record<AutoOutcome, ResultOutcome> = { passed: 'Passed', flaky: 'Passed', failed: 'Failed', skipped: 'NotExecuted' }
const RANK: Record<ResultOutcome, number> = { Failed: 4, Blocked: 3, Passed: 2, Inconclusive: 1, NotApplicable: 0, NotExecuted: 0 }

/** One result per point: a point several tests report to fails if any of them failed. */
export function resultsForPoints(matches: Match[]): PointResultInput[] {
  const byPoint = new Map<number, { outcome: ResultOutcome; tests: AutoResult[] }>()
  for (const m of matches) {
    for (const id of m.pointIds) {
      const cur = byPoint.get(id)
      const o = RESULT[m.result.outcome]
      if (!cur) byPoint.set(id, { outcome: o, tests: [m.result] })
      else { cur.tests.push(m.result); if (RANK[o] > RANK[cur.outcome]) cur.outcome = o }
    }
  }
  return [...byPoint.entries()].map(([pointId, { outcome, tests }]) => {
    const failed = tests.filter((t) => t.outcome === 'failed')
    const flaky = tests.filter((t) => t.outcome === 'flaky')
    const notes = [
      tests.length > 1 ? `${tests.length} automated tests: ${tests.map((t) => `${t.fullName} (${t.outcome})`).join('; ')}` : '',
      flaky.length ? `Flaky: passed on retry (${flaky.map((t) => t.fullName).join('; ')})` : '',
    ].filter(Boolean)
    return {
      pointId,
      outcome,
      comment: notes.join('\n') || undefined,
      errorMessage: failed.map((t) => (failed.length > 1 ? `${t.fullName}: ` : '') + (t.error ?? 'Failed')).join('\n') || undefined,
      stackTrace: failed.map((t) => t.stack).filter(Boolean).join('\n\n') || undefined,
      durationMs: tests.reduce((n, t) => n + t.durationMs, 0),
      automatedTestName: tests.map((t) => t.fullName).join(' | '),
      automatedTestStorage: uniq(tests.map((t) => t.file ?? '').filter(Boolean)).join(', ') || undefined,
    }
  })
}
