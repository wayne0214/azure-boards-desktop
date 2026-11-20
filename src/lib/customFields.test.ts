import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_CRITERIA, acceptanceField, descriptionField, idLikeField, inspectorFields, verificationMethodField } from './customFields'
import type { TeamContext, WorkItemType } from './types'

const type = (fieldDefs: WorkItemType['fieldDefs']): WorkItemType => ({ name: 'Requirement', referenceName: 'R', color: '000', states: [], fieldDefs })

describe('verificationMethodField', () => {
  it('finds a picklist named Verification Method', () => {
    const f = { referenceName: 'Custom.VM', name: 'Verification Method', allowedValues: ['Test'] }
    expect(verificationMethodField(type([f]))).toBe(f)
  })
  it('ignores a free-text field of that name and missing types', () => {
    expect(verificationMethodField(type([{ referenceName: 'Custom.VM', name: 'Verification Method' }]))).toBeUndefined()
    expect(verificationMethodField(undefined)).toBeUndefined()
  })
})

describe('acceptanceField', () => {
  it('uses the type definition, so an empty field can still be filled in', () => {
    const f = { referenceName: ACCEPTANCE_CRITERIA, name: 'User Acceptance Criteria' }
    expect(acceptanceField(type([f]))).toBe(f)
  })
  it('falls back for story types and skips types without it', () => {
    expect(acceptanceField({ ...type([]), name: 'User Story' })?.referenceName).toBe(ACCEPTANCE_CRITERIA)
    expect(acceptanceField(type([]))).toBeUndefined()
    expect(acceptanceField(undefined)).toBeUndefined()
  })
})

describe('idLikeField', () => {
  const old = { referenceName: 'Custom.SRSID', name: 'SRS ID' }
  it('prefers the current key field over an older ID field listed first', () => {
    const cur = { referenceName: 'Custom.SubsystemRequirementSpecificationID', name: 'Subsystem Requirement Specification ID' }
    expect(idLikeField(type([old, cur]))).toBe(cur)
    const needs = { referenceName: 'Custom.NeedsID', name: 'Needs ID' }
    expect(idLikeField(type([{ referenceName: 'Custom.UserNeedID', name: 'User Need ID' }, { referenceName: 'Custom.UATID', name: 'UAT ID' }, needs]))).toBe(needs)
    const sys = { referenceName: 'Custom.SystemRequirementSpecificationID', name: 'System Requirement Specification ID' }
    expect(idLikeField(type([{ referenceName: 'Custom.DesignInputID', name: 'Design Input ID' }, sys]))).toBe(sys)
  })
  it('falls back to the first ID field', () => {
    expect(idLikeField(type([{ referenceName: 'Custom.Rationale', name: 'Rationale' }, old]))).toBe(old)
    expect(idLikeField(type([]))).toBeUndefined()
  })
})

describe('inspectorFields', () => {
  const ctx = { fieldTypes: { 'Custom.Spec': 'html', 'Custom.Notes': 'plainText', 'Custom.Count': 'integer', 'Custom.Flag': 'boolean' } } as unknown as TeamContext
  const key = { referenceName: 'Custom.NeedsID', name: 'Needs ID' }
  const oldKey = { referenceName: 'Custom.UserNeedID', name: 'User Need ID' }
  const statements = { referenceName: 'Custom.Statements', name: 'User Needs and Stakeholder Needs Statements' }
  const category = { referenceName: 'Custom.NeedsCategory', name: 'Needs Category' }
  const source = { referenceName: 'Custom.Source', name: 'Source' }
  const spec = { referenceName: 'Custom.Spec', name: 'Specification' }
  const refs = (defs: { referenceName: string }[]) => defs.map((d) => d.referenceName)

  it('sets the key apart, keeps filled fields as rows and hides the empty ones', () => {
    const out = inspectorFields(ctx, type([oldKey, key, category, source]), { 'Custom.NeedsCategory': 'Clinical', 'Custom.Source': '  ' })
    expect(out.key).toBe(key)
    expect(refs(out.rows)).toEqual(['Custom.NeedsCategory'])
    expect(refs(out.hidden)).toEqual(['Custom.UserNeedID', 'Custom.Source'])
  })
  it('keeps required fields and false or zero values visible', () => {
    const req = { referenceName: 'Custom.Site', name: 'Site', alwaysRequired: true }
    const count = { referenceName: 'Custom.Count', name: 'Count' }
    const flag = { referenceName: 'Custom.Flag', name: 'Flag' }
    const out = inspectorFields(ctx, type([req, count, flag]), { 'Custom.Count': 0, 'Custom.Flag': false })
    expect(refs(out.rows)).toEqual(['Custom.Site', 'Custom.Count', 'Custom.Flag'])
    expect(out.hidden).toEqual([])
  })
  it('gives long plain text its own section', () => {
    const notes = { referenceName: 'Custom.Notes', name: 'Notes' }
    const long = { referenceName: 'Custom.Remark', name: 'Remark' }
    const out = inspectorFields(ctx, type([statements, notes, long, source]), { 'Custom.Remark': 'x'.repeat(61), 'Custom.Source': 'Clinic' })
    // Named like a write-up, multi-line by type, or holding a long value.
    expect(refs(out.text)).toEqual(['Custom.Statements', 'Custom.Remark'])
    // An empty multi-line field with a plain name waits with the other empty fields.
    expect(refs(out.hidden)).toEqual(['Custom.Notes'])
    expect(refs(out.rows)).toEqual(['Custom.Source'])
  })
  it('shows a filled multi-line field as a section', () => {
    const notes = { referenceName: 'Custom.Notes', name: 'Notes' }
    expect(refs(inspectorFields(ctx, type([notes]), { 'Custom.Notes': 'ok' }).text)).toEqual(['Custom.Notes'])
  })
  it('leaves rich text, picklists and ID fields out of the text sections', () => {
    const method = { referenceName: 'Custom.Method', name: 'Design Verification Description', allowedValues: ['Test'] }
    const specId = { referenceName: 'Custom.SpecID', name: 'System Requirement Specification ID' }
    const out = inspectorFields(ctx, type([spec, method, specId]), { 'Custom.Method': 'Test' })
    expect(refs(out.rich)).toEqual(['Custom.Spec'])
    expect(out.text).toEqual([])
    expect(refs(out.rows)).toEqual(['Custom.Method'])
    expect(out.key).toBe(specId)
  })
  it('handles a type that is not loaded', () => {
    expect(inspectorFields(ctx, undefined, {})).toEqual({ key: undefined, rows: [], text: [], rich: [], hidden: [] })
  })
})

describe('descriptionField', () => {
  const ctx = { fieldTypes: { 'Custom.SRSSpec': 'html', 'Custom.Rationale': 'html' } } as unknown as TeamContext
  const old = { referenceName: 'Custom.SRSSpec', name: 'Software Requirement Specification' }
  const rationale = { referenceName: 'Custom.Rationale', name: 'Rationale' }
  it('prefers the current specification field, plain text or not, over an older one listed first', () => {
    const cur = { referenceName: 'Custom.SubsystemSpec', name: 'Subsystem and Component Level Requirement Specification' }
    expect(descriptionField(ctx, type([old, cur]))).toBe(cur)
    const sys = { referenceName: 'Custom.SystemSpec', name: 'System Requirement Specification' }
    expect(descriptionField(ctx, type([{ referenceName: 'Custom.SRSSpec', name: 'Design Input Description' }, sys]))).toBe(sys)
    const needs = { referenceName: 'Custom.Statements', name: 'User Needs and Stakeholder Needs Statements' }
    expect(descriptionField(ctx, type([rationale, needs]))).toBe(needs)
  })
  it('does not take a picklist of that name', () => {
    const pick = { referenceName: 'Custom.SystemSpec', name: 'System Requirement Specification', allowedValues: ['A'] }
    expect(descriptionField(ctx, type([old, pick]))).toBe(old)
  })
  it('falls back to a rich-text field named like a description, then any rich-text field', () => {
    expect(descriptionField(ctx, type([rationale, old]))).toBe(old)
    expect(descriptionField(ctx, type([rationale]))).toBe(rationale)
    expect(descriptionField(ctx, type([{ referenceName: 'Custom.Site', name: 'Site' }]))).toBeUndefined()
  })
})
