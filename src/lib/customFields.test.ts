import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_CRITERIA, acceptanceField, verificationMethodField } from './customFields'
import type { WorkItemType } from './types'

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
