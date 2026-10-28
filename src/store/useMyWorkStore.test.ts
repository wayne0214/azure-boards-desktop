import { describe, expect, it } from 'vitest'
import { loadApi } from '@/lib/api'
import type { Identity, WorkItem, WorkItemType } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { attentionCount, isPlanning, peopleFor, isShown, isToVerify, isWaitingOnReporter, planningCount, useMyWorkStore, type PlanningByProject, type TypesByProject } from './useMyWorkStore'

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

describe('planning items in My Work', () => {
  const of = (type: string, project = 'P', state = 'Active'): WorkItem => ({ id: 2, rev: 1, fields: {
    'System.TeamProject': project, 'System.WorkItemType': type, 'System.State': state,
    'System.AssignedTo': { id: 'u1', displayName: 'u1' }, 'System.CreatedBy': { id: 'u2', displayName: 'u2' },
  } })
  // CMMI: Requirement is the requirement level; this project also has a custom portfolio level.
  const planning: PlanningByProject = { P: ['Requirement', 'User Need', 'Feature', 'Epic'] }

  it('follows the project\'s own backlog levels', () => {
    expect(isPlanning(of('Requirement'), planning)).toBe(true)
    expect(isPlanning(of('User Need'), planning)).toBe(true)
    expect(isPlanning(of('Task'), planning)).toBe(false)
    expect(isPlanning(of('Bug'), planning)).toBe(false)
  })

  it('uses the usual names until a project\'s levels are known', () => {
    expect(isPlanning(of('Feature', 'Other'), planning)).toBe(true)
    expect(isPlanning(of('User Story', 'Other'), planning)).toBe(true)
    expect(isPlanning(of('Issue', 'Other'), planning)).toBe(false)
  })

  it('hides them unless switched on', () => {
    expect(isShown(of('Epic'), planning, false)).toBe(false)
    expect(isShown(of('Epic'), planning, true)).toBe(true)
    expect(isShown(of('Task'), planning, false)).toBe(true)
  })

  it('counts only open ones for the toggle', () => {
    const withReq: TypesByProject = { P: [bug, { ...bug, name: 'Requirement', referenceName: 'Requirement' }] }
    expect(planningCount([of('Requirement'), of('Feature'), of('Task'), of('Requirement', 'P', 'Closed')], withReq, planning)).toBe(2)
  })

  it('leaves hidden ones out of the sidebar badge', () => {
    const changed = { ...of('Requirement'), fields: { ...of('Requirement').fields, 'System.ChangedDate': new Date().toISOString(), 'System.ChangedBy': { id: 'u2', displayName: 'u2' } } }
    expect(attentionCount([changed], types, 0, (it) => isShown(it, planning, false))).toBe(0)
    expect(attentionCount([changed], types, 0, (it) => isShown(it, planning, true))).toBe(1)
  })

  it('falls back to the usual names when a project\'s levels could not be read', () => {
    expect(isPlanning(of('Epic', 'Broken'), { Broken: null })).toBe(true)
    expect(isPlanning(of('Task', 'Broken'), { Broken: null })).toBe(false)
  })

  it('keeps planning items I reported in To verify, and out of the toggle count', () => {
    useAppStore.setState((st) => ({ activeOrg: 'o', settings: { ...st.settings, accounts: [me] } }))
    const withReq: TypesByProject = { P: [bug, { ...bug, name: 'Requirement', referenceName: 'Requirement' }] }
    const resolved = { ...of('Requirement', 'P', 'Resolved'), fields: { ...of('Requirement', 'P', 'Resolved').fields, 'System.CreatedBy': { id: 'u1', displayName: 'u1' } } }
    expect(isShown(resolved, planning, false, withReq)).toBe(true)
    expect(isShown(of('Requirement'), planning, false, withReq)).toBe(false)
    expect(planningCount([resolved, of('Requirement')], withReq, planning)).toBe(1)
  })

  it('remembers the choice', () => {
    useMyWorkStore.getState().setShowPlanning(true)
    expect(localStorage.getItem('mine.showPlanning')).toBe('1')
    useMyWorkStore.getState().setShowPlanning(false)
    expect(localStorage.getItem('mine.showPlanning')).toBe('0')
    expect(useMyWorkStore.getState().showPlanning).toBe(false)
  })
})

describe('people for an item in the details panel', () => {
  const board: Identity[] = [{ id: 'u1', displayName: 'Wayne Lai' }, { id: 'u2', displayName: 'Priya Natarajan' }]
  const fabrikam: Identity[] = [{ id: 'u1', displayName: 'Wayne Lai' }, { id: 'u6', displayName: 'Sofia Lindqvist' }]

  it('uses the board team for an item in the selected project', () => {
    expect(peopleFor('Contoso Mobile', 'Contoso Mobile', board, { 'Contoso Mobile': fabrikam })).toBe(board)
  })

  it('uses the item\'s own project for an item from another project', () => {
    expect(peopleFor('Fabrikam Web', 'Contoso Mobile', board, { 'Fabrikam Web': fabrikam })).toBe(fabrikam)
  })

  it('offers nobody rather than the wrong project while that project\'s people load', () => {
    expect(peopleFor('Fabrikam Web', 'Contoso Mobile', board, {})).toEqual([])
  })

  it('falls back to the loaded project members before the board team arrives', () => {
    expect(peopleFor('Contoso Mobile', 'Contoso Mobile', undefined, { 'Contoso Mobile': board })).toBe(board)
  })

  it('loads members by project name', async () => {
    await loadApi()
    useAppStore.setState({ activeOrg: 'demo-org' })
    useMyWorkStore.setState({ members: {} })
    await useMyWorkStore.getState().loadMembers('Fabrikam Web')
    const names = useMyWorkStore.getState().members['Fabrikam Web'].map((m) => m.displayName)
    expect(names).toContain('Sofia Lindqvist')
    expect(names).not.toContain('Priya Natarajan')
  })
})
