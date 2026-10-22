import { describe, expect, it } from 'vitest'
import { needsTest, tcConfig } from './config'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from '../types'

const type = (name: string, fieldDefs: FieldDef[] = [], isDisabled = false): WorkItemType => ({
  name, referenceName: `Test.${name}`, color: '000000', states: [], fieldDefs, isDisabled,
})

const method: FieldDef = { referenceName: 'Custom.VerificationMethod', name: 'Verification Method', allowedValues: ['Test', 'Inspection', 'Analysis', 'Demonstration'] }

const ctxOf = (types: WorkItemType[]): TeamContext => ({
  iterations: [], settings: null, members: [], tags: [], workItemTypes: types,
  fieldTypes: { 'Custom.AcceptanceCriteria': 'html', 'Custom.LastOutcome': 'string' },
})

const hierarchy = (req: WorkItemType) => [type('Epic'), type('Feature'), req]
const testCase = type('Test Case', [
  { referenceName: 'Custom.SDVID', name: 'SDV ID' },
  { referenceName: 'Custom.AcceptanceCriteria', name: 'Acceptance Criteria' },
  { referenceName: 'Custom.LastOutcome', name: 'Last Outcome' },
])

const srs = (v?: string): WorkItem => ({ id: 1, rev: 1, fields: v === undefined ? {} : { [method.referenceName]: v } })

describe('tcConfig', () => {
  it('is null without a context', () => {
    expect(tcConfig(null)).toBeNull()
  })

  it('is null when the process has no Test Case type', () => {
    expect(tcConfig(ctxOf(hierarchy(type('Requirement'))))).toBeNull()
  })

  it('is null when Test Case is disabled', () => {
    expect(tcConfig(ctxOf([type('Test Case', [], true)]))).toBeNull()
  })

  it('resolves process fields by name', () => {
    const cfg = tcConfig(ctxOf([...hierarchy(type('Requirement', [method])), testCase]))!
    expect(cfg.type.name).toBe('Test Case')
    expect(cfg.sdvField?.referenceName).toBe('Custom.SDVID')
    expect(cfg.lastOutcomeField?.referenceName).toBe('Custom.LastOutcome')
    expect(cfg.lastReleaseField).toBeUndefined()
    expect(cfg.methodField?.referenceName).toBe('Custom.VerificationMethod')
    expect(cfg.sharedStepsType).toBeUndefined()
    expect(cfg.extraFields).toEqual(expect.arrayContaining([
      'Custom.SDVID', 'Custom.LastOutcome', 'System.Description',
      'Microsoft.VSTS.TCM.Steps', 'Microsoft.VSTS.TCM.Parameters', 'Microsoft.VSTS.TCM.LocalDataSource',
    ]))
  })

  it('falls back to Description for preconditions and finds Shared Steps', () => {
    const cfg = tcConfig(ctxOf([testCase, type('Shared Steps')]))!
    expect(cfg.preconditionsField.referenceName).toBe('System.Description')
    expect(cfg.sharedStepsType?.name).toBe('Shared Steps')
    expect(cfg.methodField).toBeUndefined()
  })

  it('uses a custom html precondition field when present', () => {
    const tc = type('Test Case', [{ referenceName: 'Custom.Preconditions', name: 'Preconditions' }])
    const ctx = { ...ctxOf([tc]), fieldTypes: { 'Custom.Preconditions': 'html' } }
    expect(tcConfig(ctx)!.preconditionsField.referenceName).toBe('Custom.Preconditions')
  })
})

describe('needsTest', () => {
  const withMethod = tcConfig(ctxOf([...hierarchy(type('Requirement', [method])), testCase]))!
  const without = tcConfig(ctxOf([testCase]))!

  it('is true for Test, empty and missing values', () => {
    expect(needsTest(withMethod, srs('Test'))).toBe(true)
    expect(needsTest(withMethod, srs(''))).toBe(true)
    expect(needsTest(withMethod, srs())).toBe(true)
  })

  it('is false for other methods', () => {
    expect(needsTest(withMethod, srs('Inspection'))).toBe(false)
  })

  it('is true when the process has no Verification Method field', () => {
    expect(needsTest(without, srs('Inspection'))).toBe(true)
  })
})
