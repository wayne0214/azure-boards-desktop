import { describe, expect, it } from 'vitest'
import { buildHistory, fieldLabel, valueText } from './history'
import type { WorkItemType } from './types'

const types: WorkItemType[] = [{ name: 'Bug', referenceName: 'T.Bug', color: '000', states: [], fieldDefs: [{ referenceName: 'Custom.Symptom', name: 'Symptom' }] }]
const alice = { displayName: 'Alice Tan', uniqueName: 'alice@x.com' }

describe('buildHistory', () => {
  it('lists field changes newest first and drops bookkeeping fields', () => {
    const h = buildHistory([
      { rev: 1, revisedBy: alice, revisedDate: '2026-10-01T10:00:00Z', fields: { 'System.Title': { newValue: 'A' }, 'System.State': { newValue: 'New' } } },
      { rev: 2, revisedBy: alice, revisedDate: '2026-10-02T10:00:00Z', fields: { 'System.State': { oldValue: 'New', newValue: 'Active' }, 'System.Rev': { oldValue: 1, newValue: 2 }, 'System.ChangedDate': { oldValue: 'x', newValue: '2026-10-02T09:00:00Z' } } },
    ], types)
    expect(h.map((e) => e.rev)).toEqual([2, 1])
    expect(h[0].changes).toEqual([{ field: 'System.State', label: 'State', from: 'New', to: 'Active' }])
    expect(h[0].date).toBe('2026-10-02T09:00:00Z')
    expect(h[1].created).toBe(true)
    expect(h[1].changes).toEqual([])
  })

  it('skips revisions that only touched bookkeeping fields', () => {
    const h = buildHistory([{ rev: 3, fields: { 'System.Rev': { oldValue: 2, newValue: 3 }, 'System.Watermark': { oldValue: 1, newValue: 2 } } }], types)
    expect(h).toEqual([])
  })

  it('summarises long text instead of showing it', () => {
    const h = buildHistory([{ rev: 2, fields: { 'System.Description': { oldValue: '<p>old</p>', newValue: '<p>new</p>' } } }], types, { 'System.Description': 'html' })
    expect(h[0].changes[0]).toMatchObject({ label: 'Description', longText: true, from: '', to: '' })
  })

  it('shows identities, paths and priority readably', () => {
    const h = buildHistory([{ rev: 2, fields: {
      'System.AssignedTo': { newValue: alice },
      'System.IterationPath': { oldValue: 'Proj\\Sprint 1', newValue: 'Proj\\Sprint 2' },
      'Microsoft.VSTS.Common.Priority': { oldValue: 3, newValue: 1 },
    } }], types)
    expect(h[0].changes.map((c) => [c.label, c.from, c.to])).toEqual([['Assigned to', '', 'Alice Tan'], ['Iteration', 'Sprint 1', 'Sprint 2'], ['Priority', 'P3', 'P1']])
  })

  it('describes added and removed links', () => {
    const h = buildHistory([{ rev: 4, relations: {
      added: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/o/_apis/wit/workItems/12' }, { rel: 'ArtifactLink', url: 'vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F7-login', attributes: { name: 'Branch' } }],
      removed: [{ rel: 'AttachedFile', url: 'x', attributes: { name: 'shot.png' } }],
    } }], types)
    expect(h[0].links).toEqual([{ added: true, label: 'parent #12' }, { added: true, label: 'branch feature/7-login' }, { added: false, label: 'attachment shot.png' }])
  })

  it('notes a comment', () => {
    expect(buildHistory([{ rev: 5, fields: { 'System.History': { newValue: '<p>hi</p>' } } }], types)[0].commented).toBe(true)
  })
})

describe('fieldLabel / valueText', () => {
  it('uses the process field name for custom fields', () => {
    expect(fieldLabel('Custom.Symptom', types)).toBe('Symptom')
    expect(fieldLabel('Custom.RootCauseArea', types)).toBe('Root Cause Area')
  })
  it('is empty for missing values', () => {
    expect(valueText('System.Title', undefined)).toBe('')
  })
})
