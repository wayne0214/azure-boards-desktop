import { describe, expect, it } from 'vitest'
import { verificationMethodField } from './customFields'
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
