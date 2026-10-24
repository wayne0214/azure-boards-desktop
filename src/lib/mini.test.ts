import { describe, expect, it } from 'vitest'
import { activeWork, nextBooking, prStanding, prsForMe, startsIn } from './mini'
import type { PullRequest } from './pr/types'
import type { Booking } from './rooms/types'
import type { WorkItem } from './types'
import type { TypesByProject } from '@/store/useMyWorkStore'

const types = { P: [{ name: 'Task', states: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }] }] } as unknown as TypesByProject
const item = (id: number, state: string, changed: string) => ({ id, fields: { 'System.TeamProject': 'P', 'System.WorkItemType': 'Task', 'System.State': state, 'System.ChangedDate': changed } }) as unknown as WorkItem

const me = 'me'
const rv = (id: string, vote: number, isRequired = false) => ({ id, displayName: id, vote, isRequired })
const pr = (over: Partial<PullRequest>): PullRequest => ({ pullRequestId: 1, title: 't', status: 'active', createdBy: { id: 'someone', displayName: 'Someone' }, creationDate: '', sourceRefName: 'refs/heads/a', targetRefName: 'refs/heads/develop', repository: { id: 'r', name: 'r' }, reviewers: [], ...over }) as PullRequest

describe('activeWork', () => {
  it('keeps only in-progress items, newest change first', () => {
    const got = activeWork([item(1, 'New', '2026-10-01'), item(2, 'Active', '2026-10-02'), item(3, 'Active', '2026-10-05'), item(4, 'Closed', '2026-10-06')], types)
    expect(got.map((i) => i.id)).toEqual([3, 2])
  })
})

describe('prsForMe', () => {
  it('splits reviews waiting on me from my own pull requests', () => {
    const review = pr({ pullRequestId: 1, reviewers: [rv(me, 0)] })
    const voted = pr({ pullRequestId: 2, reviewers: [rv(me, 10)] })
    const mine = pr({ pullRequestId: 3, createdBy: { id: me, displayName: 'Me' } })
    const got = prsForMe([review, voted, mine], me)
    expect(got.review).toEqual([review])
    expect(got.mine).toEqual([mine])
  })
})

describe('prStanding', () => {
  it('says draft, conflicts, rejected, waiting, approved or pending', () => {
    expect(prStanding(pr({ isDraft: true }))).toBe('draft')
    expect(prStanding(pr({ mergeStatus: 'conflicts' }))).toBe('conflicts')
    expect(prStanding(pr({ reviewers: [rv('a', -10), rv('b', 10)] }))).toBe('rejected')
    expect(prStanding(pr({ reviewers: [rv('a', -5)] }))).toBe('waiting')
    expect(prStanding(pr({ reviewers: [rv('a', 5)] }))).toBe('approved')
    expect(prStanding(pr({ reviewers: [rv('a', 10), rv('b', 0, true)] }))).toBe('pending')
    expect(prStanding(pr({ reviewers: [] }))).toBe('pending')
  })
})

describe('nextBooking and startsIn', () => {
  const now = new Date('2026-10-26T09:00:00').getTime()
  const b = (start: string, end: string) => ({ id: start, subcalendar_ids: [], title: 'Standup', start_dt: start, end_dt: end, all_day: false }) as Booking

  it('picks the booking going on now or coming next', () => {
    const past = b('2026-10-26T07:00:00', '2026-10-26T08:00:00')
    const later = b('2026-10-26T14:30:00', '2026-10-26T15:00:00')
    const soon = b('2026-10-26T09:12:00', '2026-10-26T09:30:00')
    expect(nextBooking([past, later, soon], now)).toBe(soon)
    expect(nextBooking([past], now)).toBeNull()
  })

  it('says when it starts', () => {
    expect(startsIn(b('2026-10-26T08:50:00', '2026-10-26T09:30:00'), now)).toBe('now')
    expect(startsIn(b('2026-10-26T09:12:00', '2026-10-26T09:30:00'), now)).toBe('in 12 min')
    expect(startsIn(b('2026-10-26T14:30:00', '2026-10-26T15:00:00'), now)).toMatch(/^at /)
    expect(startsIn(b('2026-10-27T09:00:00', '2026-10-27T10:00:00'), now)).not.toMatch(/^at |^in /)
  })
})
