import { describe, expect, it } from 'vitest'
import { loadApi } from '@/lib/api'
import type { Identity, WorkItem, WorkItemType } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { attentionCount, handedOffOrder, myWorkProjects, myWorkTabs, isPlanning, isReadyToTest, isResolved, isShown, peopleFor, planningCount, useMyWorkStore, type PlanningByProject, type TypesByProject } from './useMyWorkStore'

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

describe('resolved items stay with their owner', () => {
  it('counts Resolved as resolved, whoever reported it', () => {
    expect(isResolved(item('Resolved', 'u1', 'u2'), types)).toBe(true)
    expect(isResolved(item('Resolved', 'u1', 'u1'), types)).toBe(true)
  })

  it('keeps active work active', () => {
    expect(isResolved(item('Active', 'u1', 'u2'), types)).toBe(false)
  })

  it('keeps Ready to Test apart from Resolved, whatever its category', () => {
    const asResolved: TypesByProject = { P: [{ ...bug, states: [...bug.states, { name: 'Ready to Test', color: '0', category: 'Resolved' }] }] }
    expect(isReadyToTest(item('Ready to Test', 'u1', 'u2'))).toBe(true)
    expect(isReadyToTest(item('ready to test', 'u1', 'u2'))).toBe(true)
    expect(isResolved(item('Ready to Test', 'u1', 'u2'), asResolved)).toBe(false)
    expect(isReadyToTest(item('Resolved', 'u1', 'u2'))).toBe(false)
  })

  it('counts changes to Ready to Test items in the sidebar badge, as open work', () => {
    useAppStore.setState((st) => ({ activeOrg: 'o', settings: { ...st.settings, accounts: [me] } }))
    const changed: WorkItem = { ...item('Ready to Test', 'u1', 'u2'), fields: { ...item('Ready to Test', 'u1', 'u2').fields, 'System.ChangedDate': new Date().toISOString(), 'System.ChangedBy': { id: 'u2', displayName: 'u2' } } }
    expect(attentionCount([changed], types, 0)).toBe(1)
  })

  it('falls back to the state name until types are known', () => {
    expect(isResolved(item('Resolved', 'u1', 'u2'), {})).toBe(true)
    expect(isResolved(item('Active', 'u1', 'u2'), {})).toBe(false)
  })

  it('does not count resolved items in the sidebar badge', () => {
    useAppStore.setState((st) => ({ activeOrg: 'o', settings: { ...st.settings, accounts: [me] } }))
    const changed = (state: string): WorkItem => ({ ...item(state, 'u1', 'u2'), fields: { ...item(state, 'u1', 'u2').fields, 'System.ChangedDate': new Date().toISOString(), 'System.ChangedBy': { id: 'u2', displayName: 'u2' } } })
    expect(attentionCount([changed('Resolved')], types, 0)).toBe(0)
    expect(attentionCount([changed('Active')], types, 0)).toBe(1)
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

  it('leaves resolved planning items out of the toggle count', () => {
    const withReq: TypesByProject = { P: [bug, { ...bug, name: 'Requirement', referenceName: 'Requirement' }] }
    expect(isShown(of('Requirement', 'P', 'Resolved'), planning, false)).toBe(false)
    expect(planningCount([of('Requirement', 'P', 'Resolved'), of('Requirement')], withReq, planning)).toBe(1)
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

describe('work assigned to others', () => {
  const at = (id: number, state: string, changed: string): WorkItem => ({ ...item(state, 'u2', 'u1'), id, fields: { ...item(state, 'u2', 'u1').fields, 'System.ChangedDate': changed } })

  it('lists work not started first, then in progress, then waiting on test, each oldest first', () => {
    const withNew: TypesByProject = { P: [{ ...bug, states: [{ name: 'New', color: '0', category: 'Proposed' }, ...bug.states] }] }
    const list = [at(1, 'Ready to Test', '2026-10-01'), at(2, 'Active', '2026-10-05'), at(3, 'New', '2026-10-09'), at(4, 'Active', '2026-10-02')]
    expect([...list].sort(handedOffOrder(withNew)).map((it) => it.id)).toEqual([3, 4, 2, 1])
  })

  it('loads apart from my own work, so it never counts toward the badge', async () => {
    await loadApi()
    useAppStore.setState((st) => ({ activeOrg: 'demo-org', settings: { ...st.settings, accounts: [{ org: 'demo-org', userId: 'u1', userName: 'Wayne Lai' }] } }))
    await useMyWorkStore.getState().load()
    const { items, others } = useMyWorkStore.getState()
    expect(others?.length).toBeGreaterThan(0)
    expect(others!.every((it) => (it.fields['System.AssignedTo'] as { id?: string }).id !== 'u1')).toBe(true)
    expect(items!.some((it) => others!.some((o) => o.id === it.id))).toBe(false)
  })
})

describe('My Work tabs', () => {
  const at = (id: number, project: string, state: string, assignedTo: string, changed: string): WorkItem => ({ id, rev: 1, fields: {
    'System.TeamProject': project, 'System.WorkItemType': 'Bug', 'System.State': state, 'System.Title': `Item ${id}`,
    'System.AssignedTo': { id: assignedTo, displayName: assignedTo }, 'System.ChangedDate': changed,
  } })
  const tabTypes: TypesByProject = { P: [bug], Q: [bug] }
  const base = { types: tabTypes, planning: {}, showPlanning: true, search: '', project: null }
  const items = [at(1, 'P', 'Active', 'u1', '2026-10-01'), at(2, 'Q', 'Resolved', 'u1', '2026-10-02'), at(3, 'Q', 'Active', 'u1', '2026-10-03')]
  const others = [at(4, 'P', 'Active', 'u2', '2026-10-04'), at(3, 'Q', 'Active', 'u2', '2026-09-01')]
  const closed = [at(5, 'P', 'Closed', 'u1', '2026-10-01'), at(6, 'Q', 'Closed', 'u2', '2026-10-05')]

  it('splits my work by tab and keeps an item reassigned to me out of Assigned to others', () => {
    const t = myWorkTabs({ ...base, items, others, closed })
    expect(t.active.map((it) => it.id)).toEqual([3, 1])
    expect(t.resolved.map((it) => it.id)).toEqual([2])
    expect(t.others.map((it) => it.id)).toEqual([4])
  })

  it('lists closed work newest first', () => {
    expect(myWorkTabs({ ...base, items, others, closed }).closed.map((it) => it.id)).toEqual([6, 5])
  })

  it('narrows every tab, closed work included, to one project', () => {
    const t = myWorkTabs({ ...base, items, others, closed, project: 'Q' })
    expect([...t.active, ...t.resolved, ...t.others, ...t.closed].every((it) => it.fields['System.TeamProject'] === 'Q')).toBe(true)
    expect(t.closed.map((it) => it.id)).toEqual([6])
  })

  it('offers each project once, by name', () => {
    expect(myWorkProjects(items, others, null, closed)).toEqual(['P', 'Q'])
  })

  it('remembers the tab and project per organization, and loads closed work when asked', async () => {
    await loadApi()
    useAppStore.setState((st) => ({ activeOrg: 'demo-org', settings: { ...st.settings, accounts: [{ org: 'demo-org', userId: 'u1', userName: 'Wayne Lai' }] } }))
    useMyWorkStore.setState({ org: null })
    await useMyWorkStore.getState().load()
    useMyWorkStore.getState().setTab('others')
    useMyWorkStore.getState().setProject('Contoso Mobile')
    expect(useMyWorkStore.getState().closed).toBeNull()
    useMyWorkStore.getState().setOthersMode('closed')
    await new Promise((r) => setTimeout(r, 500))
    expect(useMyWorkStore.getState().closed?.length).toBeGreaterThan(0)
    // Coming back to the organization brings the same tab and project.
    useMyWorkStore.setState({ org: null })
    await useMyWorkStore.getState().load()
    expect(useMyWorkStore.getState()).toMatchObject({ tab: 'others', project: 'Contoso Mobile', othersMode: 'open', closed: null })
  })
})
