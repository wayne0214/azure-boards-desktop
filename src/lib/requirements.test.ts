import { describe, expect, it } from 'vitest'
import { buildTree, reqConfig, textHtml } from './requirements'
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

describe('reqConfig key fields', () => {
  it('uses the current key over an older ID field and keeps the tier label short', () => {
    const cfg = reqConfig(ctxWith([{ referenceName: 'Custom.SRSID', name: 'SRS ID' }, { referenceName: 'Custom.SubsystemRequirementSpecificationID', name: 'Subsystem Requirement Specification ID' }]))!
    expect(cfg.tiers[2].idField?.referenceName).toBe('Custom.SubsystemRequirementSpecificationID')
    expect(cfg.tiers[2].label).toBe('SRS')
    expect(cfg.extraFields).toContain('Custom.SubsystemRequirementSpecificationID')
  })

  it('still labels a tier from a short ID field name', () => {
    expect(reqConfig(ctxWith([{ referenceName: 'Custom.SRSID', name: 'SRS ID' }]))!.tiers[2].label).toBe('SRS')
    expect(reqConfig(ctxWith([{ referenceName: 'Custom.ReqNo', name: 'Design Input No' }]))!.tiers[2].label).toBe('Design Input')
  })
})

describe('requirement text', () => {
  const oldSpec: FieldDef = { referenceName: 'Custom.SRSSpec', name: 'Software Requirement Specification' }
  const newSpec: FieldDef = { referenceName: 'Custom.SubsystemSpec', name: 'Subsystem and Component Level Requirement Specification' }
  const ctx = (fields: FieldDef[]): TeamContext => ({ ...ctxWith(fields), fieldTypes: { 'Custom.SRSSpec': 'html' } })
  const node = (cfg: NonNullable<ReturnType<typeof reqConfig>>, fields: Record<string, unknown>) =>
    buildTree(cfg, cfg.tiers.map((t) => t.type), [item(1, 'Epic'), item(2, 'Feature', { 'System.Parent': 1 }), item(3, 'Requirement', { 'System.Parent': 2, ...fields })], []).byId.get(3)!

  it('reads the current specification field and fetches it', () => {
    const cfg = reqConfig(ctx([oldSpec, newSpec]))!
    expect(cfg.tiers[2].textField).toBe(newSpec)
    expect(cfg.extraFields).toContain('Custom.SubsystemSpec')
    expect(node(cfg, { 'Custom.SubsystemSpec': 'The application shall run offline.' }).gaps).not.toContain(`No ${newSpec.name}`)
    expect(node(cfg, { 'Custom.SRSSpec': '<p>Old text</p>' }).gaps).toContain(`No ${newSpec.name}`)
  })
  it('turns plain text into safe HTML that keeps its line breaks', () => {
    const cfg = reqConfig(ctx([oldSpec, newSpec]))!
    expect(textHtml(node(cfg, { 'Custom.SubsystemSpec': 'Latency < 2 s\nand > 0\n\nSecond part' }))).toBe('<p>Latency &lt; 2 s<br>and &gt; 0</p><p>Second part</p>')
    expect(textHtml(node(cfg, {}))).toBe('')
  })
  it('leaves rich text as stored', () => {
    const cfg = reqConfig(ctx([oldSpec]))!
    expect(textHtml(node(cfg, { 'Custom.SRSSpec': '<p>The <b>app</b></p>' }))).toBe('<p>The <b>app</b></p>')
  })
})
