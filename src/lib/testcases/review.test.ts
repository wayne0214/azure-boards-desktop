import { describe, expect, it } from 'vitest'
import type { WorkItem } from '../types'
import { baselineRev, reviewMarks, specChangedSince, withReviewMark } from './review'

const spec = 'Custom.SRSSpec'
const updates = [
  { id: 1, rev: 1, revisedDate: '2026-09-01T10:00:00Z', fields: { [spec]: { newValue: '<p>v1</p>' } } },
  { id: 2, rev: 3, revisedDate: '2026-09-10T10:00:00Z', revisedBy: { displayName: 'Priya' }, fields: { 'System.State': { oldValue: 'New', newValue: 'Active' } } },
  { id: 3, rev: 5, revisedDate: '2026-10-14T10:00:00Z', revisedBy: { displayName: 'Priya' }, fields: { [spec]: { oldValue: '<p>v1</p>', newValue: '<p>v2</p>' } } },
]

describe('review marks', () => {
  it('replace an older mark for the same SRS', () => {
    expect(withReviewMark('a; reviewed:SRS#41@3', { srsId: 41, rev: 7 })).toBe('a; reviewed:SRS#41@7')
    expect(withReviewMark('', { srsId: 41, rev: 7 })).toBe('reviewed:SRS#41@7')
  })
  it('are read from tags', () => {
    const t = { id: 1, rev: 1, fields: { 'System.Tags': 'ui; reviewed:SRS#41@7; reviewed:SRS#52@2' } } as WorkItem
    expect(reviewMarks(t)).toEqual([{ srsId: 41, rev: 7 }, { srsId: 52, rev: 2 }])
  })
})

describe('specChangedSince', () => {
  it('finds the first change to a checked field after a revision', () => {
    expect(specChangedSince(updates, [spec], 3)).toEqual({ rev: 5, date: '2026-10-14T10:00:00Z', by: 'Priya', field: spec, oldValue: '<p>v1</p>', newValue: '<p>v2</p>' })
  })
  it('ignores changes to other fields', () => {
    expect(specChangedSince(updates.slice(0, 2), [spec], 1)).toBeNull()
  })
})

describe('baselineRev', () => {
  it('is the revision the SRS had when the test case was written', () => {
    expect(baselineRev(updates, '2026-09-20T00:00:00Z')).toBe(3)
    expect(baselineRev(updates, '2026-08-01T00:00:00Z')).toBe(0)
  })
})
