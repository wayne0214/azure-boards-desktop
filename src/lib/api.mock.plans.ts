// Demo Test Plans data for browser mode.
import type { Api } from './api'
import type { TpConfiguration, TpPerson, TpPlan, TpPoint, TpResult, TpRun, TpSuite } from './testplans/types'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

const me: TpPerson = { id: 'u1', displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' }
const mei: TpPerson = { id: 'u5', displayName: 'Mei Ling', uniqueName: 'mei@example.com' }

/** What the demo needs to know about the demo work items. */
export interface MockLookup {
  title(id: number): string
  /** Test cases linked to a requirement by Tested By. */
  testedBy(requirementId: number): number[]
  /** Test cases carrying a tag. */
  tagged(tag: string): number[]
}

export function mockPlans(lookup: MockLookup): Pick<Api, 'tpPlans' | 'tpCreatePlan' | 'tpSuites' | 'tpCreateSuite' | 'tpAddCases' | 'tpRemoveCases' | 'tpConfigurations' | 'tpPoints' | 'tpUpdatePoints' | 'tpPublishRun' | 'tpRuns' | 'tpRunResults' | 'tpSetPlanState'> {
  const configurations: TpConfiguration[] = [{ id: 1, name: 'macOS', isDefault: true }, { id: 2, name: 'Windows 11', isDefault: false }]
  const plans: TpPlan[] = [
    { id: 10, name: 'Release 2.1.0', state: 'Active', iteration: 'Contoso Mobile\\Sprint 24', areaPath: 'Contoso Mobile', rootSuiteId: 100, owner: 'Wayne Lai', startDate: daysAgo(6), endDate: daysAgo(-8), updatedDate: daysAgo(0) },
    { id: 9, name: 'Release 2.0.0', state: 'Inactive', iteration: 'Contoso Mobile\\Sprint 22', areaPath: 'Contoso Mobile', rootSuiteId: 90, owner: 'Wayne Lai', updatedDate: daysAgo(30) },
  ]
  const suites = new Map<number, TpSuite[]>([
    [10, [
      { id: 100, name: 'Release 2.1.0', suiteType: 'staticTestSuite' },
      { id: 101, name: '1164 : Resume interrupted uploads', parentId: 100, suiteType: 'requirementTestSuite', requirementId: 1164 },
      { id: 102, name: '1182 : Pose check retake', parentId: 100, suiteType: 'requirementTestSuite', requirementId: 1182 },
      { id: 103, name: '1171 : Clinic dashboard', parentId: 100, suiteType: 'requirementTestSuite', requirementId: 1171 },
      { id: 104, name: 'Smoke', parentId: 100, suiteType: 'staticTestSuite' },
    ]],
    [9, [{ id: 90, name: 'Release 2.0.0', suiteType: 'staticTestSuite' }]],
  ])
  /** Configurations each suite gives new points; the plan's root suite decides for the plan. */
  const suiteConfigs = new Map<number, number[]>()
  const points: TpPoint[] = []
  let nextPoint = 5000
  let nextId = 200
  let nextRun = 700
  const addPoint = (suiteId: number, testCaseId: number, configurationId: number, extra: Partial<TpPoint> = {}) => {
    if (points.some((p) => p.suiteId === suiteId && p.testCaseId === testCaseId && p.configurationId === configurationId)) return
    const cfg = configurations.find((c) => c.id === configurationId)!
    points.push({ id: nextPoint++, suiteId, testCaseId, testCaseTitle: lookup.title(testCaseId), configurationId, configurationName: cfg.name, outcome: 'unspecified', isAutomated: false, ...extra })
  }
  const ran = (outcome: string, by: TpPerson, d: number, automated = false): Partial<TpPoint> => ({ outcome, lastRunDate: daysAgo(d), lastRunBy: by.displayName, lastRunId: nextRun++, lastResultId: 100000 + nextRun, isAutomated: automated })
  const planOf = (suiteId: number) => [...suites.entries()].find(([, list]) => list.some((s) => s.id === suiteId))?.[0]
  const configsFor = (suiteId: number): number[] => {
    const plan = planOf(suiteId)
    const root = plan != null ? plans.find((p) => p.id === plan)?.rootSuiteId : undefined
    return suiteConfigs.get(suiteId) ?? (root != null ? suiteConfigs.get(root) : undefined) ?? [configurations.find((c) => c.isDefault)!.id]
  }
  suiteConfigs.set(100, [1, 2])
  for (const [suiteId, req] of [[101, 1164], [102, 1182], [103, 1171]] as const) for (const tc of lookup.testedBy(req)) for (const c of [1, 2]) addPoint(suiteId, tc, c, { tester: c === 1 ? me : mei })
  for (const tc of [1301, 1305]) for (const c of [1, 2]) addPoint(104, tc, c, { tester: me })
  // Some history: a passed automated run on macOS, a manual failure on Windows, one blocked.
  const set = (suiteId: number, tc: number, cfg: number, extra: Partial<TpPoint>) => { const p = points.find((x) => x.suiteId === suiteId && x.testCaseId === tc && x.configurationId === cfg); if (p) Object.assign(p, extra) }
  set(101, 1301, 1, ran('passed', me, 1, true))
  set(101, 1301, 2, ran('passed', mei, 1, true))
  set(101, 1302, 1, ran('passed', me, 2))
  set(102, 1303, 1, ran('passed', me, 2))
  set(102, 1303, 2, ran('failed', mei, 1))
  set(102, 1302, 2, ran('blocked', mei, 1))
  set(103, 1306, 1, ran('failed', me, 0))
  set(104, 1301, 1, ran('passed', me, 0, true))
  for (const tc of [1301, 1303]) addPoint(90, tc, 1, { ...ran('passed', me, 31), tester: me })

  const lower = (o: string) => o.charAt(0).toLowerCase() + o.slice(1)
  /** Runs per plan, with their results, as Azure DevOps keeps them. */
  const runs: (TpRun & { planId: number; results: TpResult[] })[] = []
  let nextResult = 900000
  const addRun = (planId: number, name: string, buildNumber: string | undefined, automated: boolean, rs: { pointId: number; outcome: string }[], daysBack = 0) => {
    const id = nextRun++
    const when = daysAgo(daysBack)
    runs.push({
      id, planId, name, buildNumber, state: 'Completed', isAutomated: automated, completedDate: when, totalTests: rs.length, passedTests: rs.filter((r) => r.outcome === 'passed').length,
      results: rs.map((r) => ({ runId: id, resultId: nextResult++, pointId: r.pointId, outcome: r.outcome, completedDate: when, runBy: me.displayName })),
    })
    return id
  }
  // History: 0.4.0 was tested in full, 0.5.0 is under way.
  const pointsOf = (suiteIds: number[]) => points.filter((p) => suiteIds.includes(p.suiteId))
  addRun(10, 'SDV run 0.4.0', '0.4.0', false, pointsOf([101, 102, 103, 104]).map((p, i) => ({ pointId: p.id, outcome: i % 5 === 3 ? 'failed' : 'passed' })), 9)
  addRun(10, 'Automated · results.json · 0.5.0', '0.5.0', true, pointsOf([101, 104]).filter((p) => p.testCaseId === 1301).map((p) => ({ pointId: p.id, outcome: 'passed' })), 1)

  return {
    tpPlans: async (_o, _p, activeOnly) => { await delay(); return structuredClone(plans.filter((p) => !activeOnly || p.state === 'Active')) },
    tpCreatePlan: async (_o, _p, input) => {
      await delay(400)
      const id = nextId++
      const root = nextId++
      const plan: TpPlan = { id, name: input.name, state: 'Active', iteration: input.iteration, areaPath: input.areaPath, rootSuiteId: root, owner: me.displayName, startDate: input.startDate, endDate: input.endDate, updatedDate: new Date().toISOString() }
      plans.unshift(plan)
      suites.set(id, [{ id: root, name: input.name, suiteType: 'staticTestSuite' }])
      if (input.configurationIds.length) suiteConfigs.set(root, input.configurationIds)
      return structuredClone(plan)
    },
    tpSuites: async (_o, _p, planId) => { await delay(); return structuredClone(suites.get(planId) ?? []) },
    tpCreateSuite: async (_o, _p, planId, input) => {
      await delay(250)
      const suite: TpSuite = { id: nextId++, name: input.name, parentId: input.parentId, suiteType: input.requirementId ? 'requirementTestSuite' : input.tag ? 'dynamicTestSuite' : 'staticTestSuite', requirementId: input.requirementId, tag: input.tag }
      suites.set(planId, [...(suites.get(planId) ?? []), suite])
      if (input.requirementId) for (const tc of lookup.testedBy(input.requirementId)) for (const c of configsFor(suite.id)) addPoint(suite.id, tc, c)
      if (input.tag) for (const tc of lookup.tagged(input.tag)) for (const c of configsFor(suite.id)) addPoint(suite.id, tc, c)
      return structuredClone(suite)
    },
    tpAddCases: async (_o, _p, _plan, suiteId, ids, configurationIds) => {
      await delay(300)
      for (const id of ids) for (const c of configurationIds?.length ? configurationIds : configsFor(suiteId)) addPoint(suiteId, id, c)
    },
    tpRemoveCases: async (_o, _p, _plan, suiteId, ids) => {
      await delay(250)
      for (let i = points.length - 1; i >= 0; i--) if (points[i].suiteId === suiteId && ids.includes(points[i].testCaseId)) points.splice(i, 1)
    },
    tpSetPlanState: async (_o, _p, planId, state) => {
      await delay(250)
      const plan = plans.find((p) => p.id === planId)!
      plan.state = state
      return structuredClone(plan)
    },
    tpRuns: async (_o, _p, planId) => {
      await delay(150)
      return structuredClone(runs.filter((r) => r.planId === planId).map(({ planId: _plan, results: _results, ...r }) => r).sort((a, b) => b.id - a.id))
    },
    tpRunResults: async (_o, _p, runIds) => { await delay(200); return structuredClone(runs.filter((r) => runIds.includes(r.id)).flatMap((r) => r.results)) },
    tpConfigurations: async () => { await delay(100); return structuredClone(configurations) },
    tpPoints: async (_o, _p, _plan, suiteId) => { await delay(180); return structuredClone(points.filter((p) => p.suiteId === suiteId)) },
    tpUpdatePoints: async (_o, _p, _plan, _suite, updates) => {
      await delay(250)
      const people = [me, mei]
      const out: TpPoint[] = []
      for (const u of updates) {
        const p = points.find((x) => x.id === u.id)
        if (!p) continue
        if (u.outcome === 'reset') Object.assign(p, { outcome: 'unspecified', lastRunDate: undefined, lastRunBy: undefined })
        else if (u.outcome) {
          // Azure DevOps records a mark as a run of its own, with no version.
          Object.assign(p, ran(u.outcome, me, 0))
          addRun(planOf(p.suiteId) ?? 0, 'Marked', undefined, false, [{ pointId: p.id, outcome: u.outcome }])
        }
        if (u.testerId) p.tester = people.find((x) => x.id === u.testerId) ?? p.tester
        out.push(structuredClone(p))
      }
      return out
    },
    tpPublishRun: async (_o, _p, input) => {
      await delay(600)
      const runId = addRun(input.planId, input.name, input.buildNumber, input.automated, input.results.map((r) => ({ pointId: r.pointId, outcome: lower(r.outcome) })))
      for (const r of input.results) {
        const p = points.find((x) => x.id === r.pointId)
        if (p) Object.assign(p, { outcome: lower(r.outcome), lastRunDate: new Date().toISOString(), lastRunBy: me.displayName, lastRunId: runId, isAutomated: input.automated })
      }
      return { runId, published: input.results.length }
    },
  }
}
