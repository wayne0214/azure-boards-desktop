import { describe, expect, it } from 'vitest'
import type { PullRequest } from '../pr/types'
import type { WorkItem } from '../types'
import { diff, failedChecks, waitingForReview, type Signals } from './watch'

const me = 'u1'
const pr = (id: number, over: Partial<PullRequest> = {}): PullRequest => ({
  pullRequestId: id, title: `PR ${id}`, status: 'active', createdBy: { id: 'u2', displayName: 'Priya' }, creationDate: '', sourceRefName: '', targetRefName: '',
  repository: { id: 'r', name: 'repo' }, reviewers: [{ id: me, displayName: 'Me', vote: 0 }], ...over,
})
const item = (id: number, fields: Record<string, unknown> = {}): WorkItem => ({ id, rev: 1, fields: { 'System.Title': `Item ${id}`, 'System.TeamProject': 'P', 'System.AssignedTo': { id: me, displayName: 'Me' }, 'System.ChangedBy': { id: 'u2', displayName: 'Priya' }, ...fields } })
const none: Signals = { reviewing: [], work: [], mentions: [], failing: [] }

describe('waitingForReview', () => {
  it('keeps pull requests waiting on my vote', () => {
    const prs = [pr(1), pr(2, { isDraft: true }), pr(3, { createdBy: { id: me, displayName: 'Me' } }), pr(4, { reviewers: [{ id: me, displayName: 'Me', vote: 10 }] }), pr(5, { reviewers: [{ id: 'u3', displayName: 'X', vote: 0 }] })]
    expect(waitingForReview(prs, me).map((p) => p.pullRequestId)).toEqual([1])
  })
})

describe('failedChecks', () => {
  it('uses the newest status per check and blocking rejected policies', () => {
    expect(failedChecks({
      statuses: [
        { id: 1, state: 'failed', context: { name: 'build' }, creationDate: '2026-10-01' },
        { id: 2, state: 'succeeded', context: { name: 'build' }, creationDate: '2026-10-02' },
        { id: 3, state: 'error', context: { name: 'lint' }, creationDate: '2026-10-02' },
      ],
      policies: [
        { evaluationId: 'a', status: 'rejected', configuration: { type: { displayName: 'Build' }, isBlocking: true } },
        { evaluationId: 'b', status: 'rejected', configuration: { type: { displayName: 'Optional' }, isBlocking: false } },
        { evaluationId: 'c', status: 'approved', configuration: { type: { displayName: 'Reviewers' } } },
      ],
    })).toEqual(['lint', 'Build'])
  })
})

describe('diff', () => {
  it('is quiet on the first run and records a baseline', () => {
    const r = diff(null, { ...none, reviewing: [pr(1)], work: [item(5)] }, me)
    expect(r.notes).toEqual([])
    expect(r.next).toEqual({ reviews: [1], assigned: [5], mentions: [], failing: [] })
  })

  it('announces only what is new', () => {
    const prev = { reviews: [1], assigned: [5], mentions: [7], failing: ['9:build'] }
    const r = diff(prev, {
      reviewing: [pr(1), pr(2)],
      work: [item(5), item(6)],
      mentions: [item(7), item(8)],
      failing: [{ pr: pr(9), checks: ['build', 'lint'] }],
    }, me)
    expect(r.notes.map((n) => n.key)).toEqual(['review:2', 'assigned:6', 'mention:8', 'check:9:lint'])
    expect(r.notes[2].title).toBe('Priya mentioned you in #8')
  })

  it('does not announce what the user did', () => {
    const prev = { reviews: [], assigned: [], mentions: [], failing: [] }
    const mine = { 'System.ChangedBy': { id: me } }
    const r = diff(prev, { ...none, work: [item(6, mine)], mentions: [item(8, mine)] }, me)
    expect(r.notes).toEqual([])
  })

  it('ignores My Work items that are not assigned to the user', () => {
    const prev = { reviews: [], assigned: [], mentions: [], failing: [] }
    const r = diff(prev, { ...none, work: [item(6, { 'System.AssignedTo': { id: 'u2' } })] }, me)
    expect(r.notes).toEqual([])
    expect(r.next.assigned).toEqual([])
  })

  it('stays quiet for a kind that has no baseline yet', () => {
    const r = diff({ reviews: [] }, { ...none, reviewing: [pr(1)], work: [item(6)] }, me)
    expect(r.notes.map((n) => n.key)).toEqual(['review:1'])
  })

  it('does not announce a mention again when the item comes back into the query', () => {
    const gone = diff({ reviews: [], assigned: [], mentions: [8], failing: [] }, none, me)
    expect(gone.next.mentions).toEqual([8])
    expect(diff(gone.next, { ...none, mentions: [item(8)] }, me).notes).toEqual([])
  })

  it('announces a review again after it left and came back', () => {
    const first = diff({ reviews: [1], assigned: [], mentions: [], failing: [] }, none, me)
    expect(first.next.reviews).toEqual([])
    expect(diff(first.next, { ...none, reviewing: [pr(1)] }, me).notes.map((n) => n.key)).toEqual(['review:1'])
  })
})
