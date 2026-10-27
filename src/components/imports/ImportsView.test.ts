import { describe, expect, it } from 'vitest'
import type { FieldChange, ReviewRow } from '@/lib/mcp'
import { canEdit } from './ImportsView'

const row = (category: ReviewRow['category'], key: string | null = 'SRS-1'): ReviewRow => ({ rowKey: 'r0', fp: 'new', category, type: 'Requirement', key, title: 'T', workItemId: null, matchedBy: null, parent: null, parentRow: null, error: null, note: null, changes: [] })
const change = (kind: FieldChange['kind'], after = 'Text', field = 'Custom.Spec', locked?: string): FieldChange => ({ field, name: 'Spec', kind, before: '', after, write: true, locked })

describe('canEdit', () => {
  it('lets the file text of fields that would be written be edited', () => {
    expect(canEdit(row('changed'), change('fill'))).toBe(true)
    expect(canEdit(row('conflict'), change('conflict'))).toBe(true)
    expect(canEdit(row('new'), change('fill'))).toBe(true)
  })

  it('keeps links, the parent, locked fields, the matched key and other rows as they are', () => {
    expect(canEdit(row('changed'), change('add'))).toBe(false)
    expect(canEdit(row('conflict'), change('conflict', '#12', 'System.Parent'))).toBe(false)
    expect(canEdit(row('conflict'), change('conflict', 'x', 'Microsoft.VSTS.TCM.Steps', 'Uses shared steps'))).toBe(false)
    expect(canEdit(row('new'), change('fill', 'SRS-1', 'Custom.SRSID'))).toBe(false)
    expect(canEdit(row('changed'), change('same'))).toBe(false)
    expect(canEdit(row('missing'), change('fill'))).toBe(false)
    expect(canEdit(row('error'), change('fill'))).toBe(false)
  })
})
