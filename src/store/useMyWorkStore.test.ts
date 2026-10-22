import { describe, expect, it } from 'vitest'
import type { WorkItem, WorkItemType } from '@/lib/types'
import { attentionCount, isToVerify, isWaitingOnReporter, type TypesByProject } from './useMyWorkStore'

const me = { org: 'o', userId: 'u1', userName: 'Wayne Lai' }
const bug: WorkItemType = { name: 'Bug', referenceName: 'Bug', color: '000', states: [
  { name: 'Active', color: '0', category: 'InProgress' },
  { name: 'Resolved', color: '0', category: 'Resolved' },
  { name: 'Closed', color: '0', category: 'Completed' },
] }
const types: TypesByProject = { P: [bug] }
const item = (state: string, assignedTo: string, createdBy: string): WorkItem => ({ id: 1, rev: 1, fields: {
  'System.TeamProject': 'P', 'System.WorkItemType': 'Bug', 'System.State': state,
  'System.AssignedTo': { id: assignedTo, displayName: assignedTo }, 'System.CreatedBy': { id: createdBy, displayName: createdBy },
} })

describe('resolved items belong to their reporter', () => {
  it('goes to the reporter\'s To verify', () => {
    expect(isToVerify(item('Resolved', 'u2', 'u1'), types, me)).toBe(true)
  })

  it('leaves the assignee\'s list once resolved', () => {
    expect(isWaitingOnReporter(item('Resolved', 'u1', 'u2'), types, me)).toBe(true)
    expect(isToVerify(item('Resolved', 'u1', 'u2'), types, me)).toBe(false)
  })

  it('stays with me when I am both assignee and reporter', () => {
    expect(isWaitingOnReporter(item('Resolved', 'u1', 'u1'), types, me)).toBe(false)
    expect(isToVerify(item('Resolved', 'u1', 'u1'), types, me)).toBe(true)
  })

  it('keeps active work with the assignee', () => {
    expect(isWaitingOnReporter(item('Active', 'u1', 'u2'), types, me)).toBe(false)
  })

  it('does not count waiting items in the sidebar badge', () => {
    expect(attentionCount([item('Resolved', 'u1', 'u2')], types, Date.now() + 1000)).toBe(0)
  })
})
