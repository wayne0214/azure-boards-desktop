import { describe, expect, it } from 'vitest'
import { buildTree, reqConfig } from './requirements'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from './types'

const method: FieldDef = { referenceName: 'Custom.VerificationMethod', name: 'Verification Method', allowedValues: ['Test', 'Inspection', 'Analysis', 'Demonstration'] }
const states = [{ name: 'New', color: '000000', category: 'Proposed' as const }]
const type = (name: string, fieldDefs: FieldDef[] = []): WorkItemType => ({ name, referenceName: `T.${name}`, color: '000000', states, fieldDefs })
const ctxWith = (reqFields: FieldDef[]): TeamContext => ({ iterations: [], settings: null, members: [], tags: [], workItemTypes: [type('Epic'), type('Feature'), type('Requirement', reqFields)], fieldTypes: {} })
const item = (id: number, wit: string, fields: Record<string, unknown> = {}): WorkItem => ({ id, rev: 1, fields: { 'System.WorkItemType': wit, 'System.State': 'New', 'System.Title': `t${id}`, ...fields } })

describe('reqConfig verification method', () => {
  it('finds the SRS type\'s Verification Method field and fetches it', () => {
    const cfg = reqConfig(ctxWith([method]))!
    expect(cfg.methodField?.referenceName).toBe('Custom.VerificationMethod')
    expect(cfg.extraFields).toContain('Custom.VerificationMethod')
  })

  it('has no method field when the process lacks one', () => {
    expect(reqConfig(ctxWith([]))!.methodField).toBeUndefined()
  })

  it('flags an SRS with no verification method as a gap', () => {
    const cfg = reqConfig(ctxWith([method]))!
    const tree = buildTree(cfg, cfg.tiers.map((t) => t.type), [item(1, 'Epic'), item(2, 'Feature', { 'System.Parent': 1 }), item(3, 'Requirement', { 'System.Parent': 2 }), item(4, 'Requirement', { 'System.Parent': 2, [method.referenceName]: 'Inspection' })], [])
    expect(tree.byId.get(3)!.gaps).toContain('No verification method')
    expect(tree.byId.get(4)!.gaps).not.toContain('No verification method')
  })
})
