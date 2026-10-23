import { describe, expect, it } from 'vitest'
import type { TpPlan, TpPoint, TpResult, TpRun } from './types'
import { compareVersions, outcomesOn, projectPlan, versionsOf, withVersion } from './versions'

const run = (id: number, buildNumber?: string): TpRun => ({ id, name: `run ${id}`, buildNumber, state: 'Completed', isAutomated: false, totalTests: 1, passedTests: 1 })
const res = (runId: number, resultId: number, pointId: number, outcome: string): TpResult => ({ runId, resultId, pointId, outcome })

describe('versions', () => {
  it('sort newest first, a release before its pre-releases', () => {
    expect(['0.9.0', '1.0.0-rc.1', '0.10.0', '1.0.0', '1.0.0-rc.2', '1.0.1'].sort(compareVersions)).toEqual(['1.0.1', '1.0.0', '1.0.0-rc.2', '1.0.0-rc.1', '0.10.0', '0.9.0'])
  })
  it('come from run build numbers and versions added by hand, once each', () => {
    expect(versionsOf([run(1, '0.3.0'), run(2, ' 0.4.0'), run(3), run(4, '0.3.0')], ['0.5.0', '0.4.0', ' '])).toEqual(['0.5.0', '0.4.0', '0.3.0'])
  })
})

describe('outcomes on a version', () => {
  const runs = [run(10, '0.4.0'), run(11, '0.5.0'), run(12, '0.4.0')]
  const results = [res(10, 1, 501, 'failed'), res(12, 5, 501, 'passed'), res(11, 2, 502, 'failed'), res(10, 3, 502, 'passed')]
  it('take the latest result of each point on that version only', () => {
    const on4 = outcomesOn('0.4.0', runs, results)
    expect([...on4.entries()].map(([p, r]) => [p, r.outcome])).toEqual([[501, 'passed'], [502, 'passed']])
    expect(outcomesOn('0.5.0', runs, results).get(501)).toBeUndefined()
  })
  it('replace point outcomes, and show the rest as not run', () => {
    const pt = (id: number): TpPoint => ({ id, suiteId: 1, testCaseId: id, testCaseTitle: '', configurationId: 1, configurationName: 'macOS', outcome: 'blocked', isAutomated: false, lastRunDate: 'x' })
    const shown = withVersion([pt(501), pt(503)], outcomesOn('0.4.0', runs, results))
    expect(shown.map((p) => [p.outcome, p.lastRunId])).toEqual([['passed', 12], ['unspecified', undefined]])
    expect(withVersion([pt(501)], null)[0].outcome).toBe('blocked')
  })
})

describe('the project plan', () => {
  const plan = (id: number, name: string, state = 'Active'): TpPlan => ({ id, name, state, iteration: '', areaPath: '', rootSuiteId: id * 10 })
  it('is the only active plan, else the one last opened, else the V&V one', () => {
    expect(projectPlan([plan(1, 'AEON'), plan(2, 'Old', 'Inactive')], 2)?.id).toBe(1)
    expect(projectPlan([plan(1, 'Smoke'), plan(2, 'AEON – V&V')], 1)?.id).toBe(1)
    expect(projectPlan([plan(1, 'Smoke'), plan(2, 'AEON – V&V')], null)?.id).toBe(2)
    expect(projectPlan([plan(2, 'Old', 'Inactive')], null)).toBeNull()
  })
})
