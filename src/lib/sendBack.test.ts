import { describe, expect, it } from 'vitest'
import { canSendBack, fixerReason, hasRichContent } from './sendBack'
import { mockApi } from './api.mock'

describe('canSendBack', () => {
  it('offers Ready to Test and closed items only', () => {
    expect(canSendBack('Ready to Test', 'Resolved')).toBe(true)
    expect(canSendBack('ready to test', undefined)).toBe(true)
    expect(canSendBack('Closed', 'Completed')).toBe(true)
    expect(canSendBack('Active', 'InProgress')).toBe(false)
    expect(canSendBack('Resolved', 'Resolved')).toBe(false)
  })
})

describe('fixerReason', () => {
  it('prefers the detail the plan gives', () => {
    expect(fixerReason({ displayName: 'P', uniqueName: 'p', reason: 'pullRequest', detail: 'wrote pull request !412' })).toBe('wrote pull request !412')
    expect(fixerReason({ displayName: 'P', uniqueName: 'p', reason: 'history', detail: '' })).toBe('held it before you')
  })
})

describe('hasRichContent', () => {
  it('needs words or an image', () => {
    expect(hasRichContent('<p>&nbsp;</p>')).toBe(false)
    expect(hasRichContent('<p><img src="x"></p>')).toBe(true)
    expect(hasRichContent('<p>Still crashes</p>')).toBe(true)
  })
})

describe('demo send back', () => {
  it('finds the pull request author and sends the item back to its type\'s first state (New in the demo, Proposed in yours) with the comment', async () => {
    const plan = await mockApi.sendBackPlan('demo', 'Parcel', 1198)
    expect(plan.fixer?.reason).toBe('pullRequest')
    expect(plan.state).toBe('New')
    const item = await mockApi.getWorkItem('demo', 'Parcel', 1198)
    const after = await mockApi.sendBack('demo', 'Parcel', 1198, item.rev, plan.fixer!.uniqueName, plan.state, '<p>Still drifts</p>')
    expect(after.fields['System.State']).toBe('New')
    expect((after.fields['System.AssignedTo'] as { displayName: string }).displayName).toBe(plan.fixer!.displayName)
    const comments = await mockApi.getComments('demo', 'Parcel', 1198)
    expect(comments.at(-1)?.text).toContain('Still drifts')
  })
})
