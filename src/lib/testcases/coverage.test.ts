import { describe, expect, it } from 'vitest'
import { buildTree, reqConfig } from '../requirements'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from '../types'
import { STEPS, tcConfig } from './config'
import { buildCoverage, hasSteps, srsLinks } from './coverage'

const method: FieldDef = { referenceName: 'Custom.VerificationMethod', name: 'Verification Method', allowedValues: ['Test', 'Inspection'] }
const states = [
  { name: 'New', color: '000000', category: 'Proposed' as const },
  { name: 'Closed', color: '000000', category: 'Completed' as const },
  { name: 'Removed', color: '000000', category: 'Removed' as const },
]
const type = (name: string, fieldDefs: FieldDef[] = []): WorkItemType => ({ name, referenceName: `T.${name}`, color: '000000', states, fieldDefs })
const types = [type('Epic'), type('Feature'), type('Requirement', [method]), type('Test Case')]
const ctx: TeamContext = { iterations: [], settings: null, members: [], tags: [], workItemTypes: types, fieldTypes: {} }

const item = (id: number, wit: string, fields: Record<string, unknown> = {}, tests: number[] = []): WorkItem => ({
  id, rev: 1, fields: { 'System.WorkItemType': wit, 'System.State': 'New', ...fields },
  relations: tests.map((t) => ({ rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `https://x/_apis/wit/workItems/${t}` })),
})
const srsItem = (id: number, m?: string, state = 'New') => item(id, 'Requirement', { 'System.Parent': 11, 'System.State': state, ...(m ? { [method.referenceName]: m } : {}) })

const rc = reqConfig(ctx)!
const cfg = tcConfig(ctx)!
const tree = buildTree(rc, types, [item(10, 'Epic'), item(11, 'Feature', { 'System.Parent': 10 }), srsItem(1, 'Test'), srsItem(2, 'Inspection'), srsItem(3), srsItem(4, 'Test', 'Removed')], [])

describe('buildCoverage', () => {
  const t1 = item(101, 'Test Case', {}, [1])
  const t2 = item(102, 'Test Case', {}, [1, 3])
  const t3 = item(103, 'Test Case')
  const t4 = item(104, 'Test Case', {}, [4])
  const t5 = item(105, 'Test Case', {}, [999])
  const cov = buildCoverage(cfg, types, tree, [t1, t2, t3, t4, t5])

  it('attaches tests to their SRS', () => {
    expect(cov.bySrs.get(1)!.tests).toEqual([t1, t2])
    expect(cov.bySrs.get(3)!.tests).toEqual([t2])
    expect(cov.bySrs.get(1)!.method).toBe('Test')
    expect(cov.bySrs.get(3)!.method).toBeNull()
  })

  it('only SRS verified by test need one', () => {
    expect(cov.bySrs.get(2)!.needsTest).toBe(false)
    expect(cov.bySrs.get(3)!.needsTest).toBe(true)
  })

  it('removed SRS never need a test', () => {
    expect(cov.bySrs.get(4)!.removed).toBe(true)
    expect(cov.bySrs.get(4)!.needsTest).toBe(false)
  })

  it('counts coverage and missing methods', () => {
    expect(cov.stats).toEqual({ needingTest: 2, covered: 2, noMethod: 1 })
  })

  it('lists tests with no live SRS as unlinked', () => {
    expect(cov.unlinked).toEqual([t3, t4, t5])
  })

  it('a closed SRS still needs coverage', () => {
    const closed = buildTree(rc, types, [item(10, 'Epic'), item(11, 'Feature', { 'System.Parent': 10 }), srsItem(1, 'Test', 'Closed')], [])
    const c = buildCoverage(cfg, types, closed, [])
    expect(c.bySrs.get(1)!.removed).toBe(false)
    expect(c.stats).toEqual({ needingTest: 1, covered: 0, noMethod: 0 })
  })
})

describe('srsLinks and hasSteps', () => {
  it('reads only tested-by relations', () => {
    const t = { ...item(1, 'Test Case', {}, [7, 8]), relations: [
      { rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: 'u/7' },
      { rel: 'System.LinkTypes.Related', url: 'u/9' },
    ] }
    expect(srsLinks(t)).toEqual([7])
  })

  it('detects steps', () => {
    expect(hasSteps(item(1, 'Test Case'))).toBe(false)
    expect(hasSteps(item(1, 'Test Case', { [STEPS]: '<steps id="0" last="1"><step id="1" type="ValidateStep"><parameterizedString isformatted="true">&lt;P&gt;Do&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;Ok&lt;/P&gt;</parameterizedString></step></steps>' }))).toBe(true)
  })
})

describe('removed test cases', () => {
  it('neither cover an SRS nor show as unlinked', () => {
    const gone = item(106, 'Test Case', { 'System.State': 'Removed' }, [1])
    const orphanGone = item(107, 'Test Case', { 'System.State': 'Removed' })
    const cov = buildCoverage(cfg, types, tree, [gone, orphanGone])
    expect(cov.bySrs.get(1)!.tests).toEqual([])
    expect(cov.unlinked).toEqual([])
    expect(cov.stats.covered).toBe(0)
  })
})
