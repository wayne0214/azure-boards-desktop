import { describe, expect, it } from 'vitest'
import { planImport, type ImportMapping } from './importPlan'

const map: ImportMapping = { sdv: 0, srs: 1, steps: 2, criteria: 3 }
const srs = new Map([['SRS-041', { id: 41, removed: false }], ['SRS-052', { id: 52, removed: false }], ['SRS-012', { id: 12, removed: true }]])

describe('planImport', () => {
  it('groups rows with the same SDV ID into one test case', () => {
    const plan = planImport([
      ['SDV-0001', 'SRS-041', '1. Open settings', '1. Settings shown'],
      ['sdv-0001', 'SRS-052', '2. Press save', '2. Saved'],
    ], map, srs, new Map())
    expect(plan).toHaveLength(1)
    expect(plan[0].srsIds).toEqual([41, 52])
    expect(plan[0].steps).toMatchObject([{ action: '<P>Open settings</P>', expected: '<P>Settings shown</P>' }, { action: '<P>Press save</P>', expected: '<P>Saved</P>' }])
  })

  it('puts each acceptance criterion on the step with the same number', () => {
    const [c] = planImport([['SDV-0007', 'SRS-041', '1. Open\n2. Fill the form\n3. Save', '1. Form shown\n3. Saved']], map, srs, new Map())
    expect(c.steps.map((s) => s.kind === 'step' && s.expected)).toEqual(['<P>Form shown</P>', '', '<P>Saved</P>'])
    expect(c.stepsText).toBe('1. Open => Form shown\n2. Fill the form\n3. Save => Saved')
  })

  it('gives unnumbered criteria to the steps in order', () => {
    const [c] = planImport([['SDV-0008', 'SRS-041', '1. Open\n2. Save', 'Form shown\nSaved']], map, srs, new Map())
    expect(c.steps.map((s) => s.kind === 'step' && s.expected)).toEqual(['<P>Form shown</P>', '<P>Saved</P>'])
  })

  it('resolves several SRS in one cell and reports unknown or removed ones', () => {
    const [c] = planImport([['SDV-0002', 'SRS-041, SRS-099; SRS-012', 'Open', '']], map, srs, new Map())
    expect(c.srsIds).toEqual([41])
    expect(c.issues).toEqual(['SRS-099 not found', 'SRS-012 is removed'])
  })

  it('splits a multi-line steps cell, accepting "Expected:" as the separator', () => {
    const [c] = planImport([['SDV-0003', 'SRS-041', '1. Open the app - Expected: Home shown\n2. Sign out', '']], map, srs, new Map())
    expect(c.steps).toHaveLength(2)
    expect(c.steps[0]).toMatchObject({ action: '<P>Open the app</P>', expected: '<P>Home shown</P>' })
    expect(c.steps[1]).toMatchObject({ action: '<P>Sign out</P>', expected: '' })
  })

  it('marks an SDV ID that already exists for update', () => {
    const [c] = planImport([['SDV-0004', 'SRS-041', 'Open', '']], map, srs, new Map([['SDV-0004', 1304]]))
    expect(c.existingId).toBe(1304)
  })

  it('titles a case from its first step when there is no title column', () => {
    const [c] = planImport([['SDV-0005', 'SRS-041', '1. Open settings => Shown', '']], map, srs, new Map())
    expect(c.title).toBe('Open settings')
    expect(c.titleGiven).toBe(false)
  })

  it('knows when the title came from the sheet', () => {
    const [c] = planImport([['SDV-0006', 'SRS-041', 'Open', '', 'Settings page']], { ...map, title: 4 }, srs, new Map())
    expect(c).toMatchObject({ title: 'Settings page', titleGiven: true })
  })

  it('skips rows without an SDV ID', () => {
    expect(planImport([['', 'SRS-041', 'Open', '']], map, srs, new Map())).toEqual([])
  })
})
