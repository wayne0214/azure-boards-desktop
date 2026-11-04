import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Identity, WorkItem, WorkItemType, WorkItemTypeState } from '@/lib/types'
import { errorMessage } from '@/lib/types'
import { useAppStore } from './useAppStore'

/** Work item types per project name; items in My Work come from projects that may use different processes. */
export type TypesByProject = Record<string, WorkItemType[]>

type IdentityRef = { id?: string; displayName?: string } | undefined

const projectOf = (it: WorkItem) => String(it.fields['System.TeamProject'] ?? '')
const isMe = (who: unknown, me: { userId?: string; userName?: string } | null) => {
  const w = who as IdentityRef
  if (!w || !me) return false
  return w.id ? w.id === me.userId : w.displayName === me.userName
}

export function typeOf(it: WorkItem, types: TypesByProject): WorkItemType | undefined {
  return types[projectOf(it)]?.find((t) => t.name === it.fields['System.WorkItemType'])
}

export function stateCategory(it: WorkItem, types: TypesByProject): WorkItemTypeState['category'] | undefined {
  return typeOf(it, types)?.states.find((s) => s.name === it.fields['System.State'])?.category
}

/** Finished by its own process: a Completed or Removed state the server query could not know about. */
export const isFinished = (it: WorkItem, types: TypesByProject) => {
  const c = stateCategory(it, types)
  return c === 'Completed' || c === 'Removed'
}

/**
 * On the test server, waiting for QA: a pipeline assigns these to the tester, so for them it is open work.
 * A custom state whose category varies by process, so it is matched by name.
 */
export const isReadyToTest = (it: WorkItem) => String(it.fields['System.State'] ?? '').toLowerCase() === 'ready to test'

/**
 * Done on my side and waiting for the lead (its pull request into develop): a Resolved state, not Ready to Test.
 * These stay in My Work, in a collapsed section, until someone else takes them or closes them.
 */
export const isResolved = (it: WorkItem, types: TypesByProject) => {
  if (isReadyToTest(it)) return false
  const c = stateCategory(it, types)
  return c ? c === 'Resolved' : it.fields['System.State'] === 'Resolved'
}

/**
 * The people an item can be assigned to or @mentioned: the board's team when the item is in the selected project,
 * otherwise its own project's members (My Work lists items from every project).
 */
export const peopleFor = (project: string, selectedProject: string | undefined, boardMembers: Identity[] | undefined, members: Record<string, Identity[]>): Identity[] =>
  (project === selectedProject ? boardMembers : undefined) ?? members[project] ?? []

/** Planning types per project name: its requirement and portfolio backlog levels; null when they could not be read. */
export type PlanningByProject = Record<string, string[] | null>

// Until a project's process configuration has loaded (or if it cannot be read), the usual names stand in.
const PLANNING_NAMES = ['Epic', 'Feature', 'Requirement', 'User Story', 'Product Backlog Item']

/** A requirement, feature or epic: something I own and plan rather than work on today. */
export const isPlanning = (it: WorkItem, planning: PlanningByProject) =>
  (planning[projectOf(it)] ?? PLANNING_NAMES).includes(String(it.fields['System.WorkItemType'] ?? ''))

/** In My Work as the user has chosen to see it: planning items only when they are switched on. */
export const isShown = (it: WorkItem, planning: PlanningByProject, showPlanning: boolean) =>
  showPlanning || !isPlanning(it, planning)

/** Open planning items, for the toggle's count: the ones My Work would list if they were switched on. */
export const planningCount = (items: WorkItem[] | null, types: TypesByProject, planning: PlanningByProject) =>
  (items ?? []).filter((it) => isPlanning(it, planning) && !isFinished(it, types) && !isResolved(it, types)).length

/**
 * Order for work handed to others: not started, then in progress, then waiting on review or test;
 * within each, the longest untouched first so a stalled item stands out.
 */
export function handedOffOrder(types: TypesByProject) {
  const rank = (it: WorkItem) => {
    if (isReadyToTest(it)) return 2
    const c = stateCategory(it, types)
    return c === 'Proposed' ? 0 : c === 'InProgress' ? 1 : c === 'Resolved' ? 2 : 3
  }
  return (a: WorkItem, b: WorkItem) => rank(a) - rank(b) || String(a.fields['System.ChangedDate'] ?? '').localeCompare(String(b.fields['System.ChangedDate'] ?? ''))
}

export type MineTab = 'active' | 'test' | 'others' | 'resolved'
export const MINE_TABS: MineTab[] = ['active', 'test', 'others', 'resolved']

const priorityOf = (it: WorkItem) => { const p = it.fields['Microsoft.VSTS.Common.Priority']; return typeof p === 'number' ? p : 9 }
const changedOf = (it: WorkItem) => String(it.fields['System.ChangedDate'] ?? '')

/**
 * What each tab lists, after the planning toggle, search and project filter. Each tab has its own order:
 * my work most urgent first, then most recently touched; items to test oldest first so nothing waits forever;
 * work handed off longest waiting first; resolved and closed items most recent first.
 */
export function myWorkTabs(opts: {
  items: WorkItem[] | null; others: WorkItem[] | null; closed: WorkItem[] | null
  types: TypesByProject; planning: PlanningByProject; showPlanning: boolean; search: string; project: string | null
}): Record<MineTab | 'closed', WorkItem[]> {
  const { types, planning, showPlanning, search, project } = opts
  const keep = (it: WorkItem) => isShown(it, planning, showPlanning) && matchesSearch(it, search) && (!project || projectOf(it) === project)
  const mine = (opts.items ?? []).filter((it) => keep(it) && !isFinished(it, types))
  // An item reassigned to me since the last load is already in my own tabs.
  const mineIds = new Set((opts.items ?? []).map((it) => it.id))
  return {
    active: mine.filter((it) => !isReadyToTest(it) && !isResolved(it, types)).sort((a, b) => priorityOf(a) - priorityOf(b) || changedOf(b).localeCompare(changedOf(a))),
    test: mine.filter(isReadyToTest).sort((a, b) => changedOf(a).localeCompare(changedOf(b))),
    others: (opts.others ?? []).filter((it) => keep(it) && !mineIds.has(it.id) && !isFinished(it, types)).sort(handedOffOrder(types)),
    resolved: mine.filter((it) => isResolved(it, types)).sort((a, b) => changedOf(b).localeCompare(changedOf(a))),
    closed: (opts.closed ?? []).filter(keep).sort((a, b) => changedOf(b).localeCompare(changedOf(a))),
  }
}

/** Projects with anything in My Work, for the project filter. */
export const myWorkProjects = (...lists: (WorkItem[] | null)[]) =>
  [...new Set(lists.flatMap((l) => (l ?? []).map(projectOf)).filter(Boolean))].sort((a, b) => a.localeCompare(b))

/** How far back the Closed view of Assigned to others looks. */
export const CLOSED_DAYS = 30

/** Changed by someone else after the given time. */
export const isUnseen = (it: WorkItem, since: number | null, me = useAppStore.getState().account()) => {
  if (since === null) return false
  const changed = Date.parse(String(it.fields['System.ChangedDate'] ?? ''))
  return changed > since && !isMe(it.fields['System.ChangedBy'], me)
}

/** What the sidebar badge counts: open items someone else changed since My Work was last opened. Resolved ones wait on others. */
export function attentionCount(items: WorkItem[] | null, types: TypesByProject, seenAt: number | null, shown: (it: WorkItem) => boolean = () => true) {
  const me = useAppStore.getState().account()
  return (items ?? []).filter((it) => shown(it) && !isFinished(it, types) && !isResolved(it, types) && isUnseen(it, seenAt, me)).length
}

/** Plain-text search over the columns shown, plus tags, project and assignee. */
export function matchesSearch(it: WorkItem, q: string) {
  const t = q.trim().toLowerCase()
  if (!t) return true
  const f = it.fields
  if (/^#?\d+$/.test(t)) return String(it.id).startsWith(t.replace('#', ''))
  const hay = [
    f['System.Title'], f['System.WorkItemType'], f['System.State'], f['System.TeamProject'], f['System.Tags'],
    String(f['System.IterationPath'] ?? '').split('\\').pop(), (f['System.AssignedTo'] as IdentityRef)?.displayName,
  ].map((v) => String(v ?? '').toLowerCase()).join(' \u0000 ')
  return t.split(/\s+/).every((w) => hay.includes(w))
}

const seenKey = (org: string) => `mine.seenAt.${org}`
const readSeen = (org: string): number | null => {
  try { const v = Number(localStorage.getItem(seenKey(org))); return v > 0 ? v : null } catch { return null }
}
const writeSeen = (org: string, at: number) => { try { localStorage.setItem(seenKey(org), String(at)) } catch { /* ignore */ } }

const readOrgKey = (k: string, org: string) => { try { return localStorage.getItem(`${k}.${org}`) } catch { return null } }
const writeOrgKey = (k: string, org: string | null, v: string | null) => {
  if (!org) return
  try { if (v === null) localStorage.removeItem(`${k}.${org}`); else localStorage.setItem(`${k}.${org}`, v) } catch { /* this session only */ }
}
const readTab = (org: string): MineTab => { const t = readOrgKey('mine.tab', org); return MINE_TABS.includes(t as MineTab) ? (t as MineTab) : 'active' }

const PLANNING_KEY = 'mine.showPlanning'
const readShowPlanning = () => { try { return localStorage.getItem(PLANNING_KEY) === '1' } catch { return false } }

/** The organization a load is running for; a load for another organization must not wait behind it. */
let loadingOrg: string | null = null

interface MyWorkState {
  org: string | null
  items: WorkItem[] | null
  /** Open work I created or was once assigned, now with someone else. Kept apart so it never counts toward the badge. */
  others: WorkItem[] | null
  /** Work handed off that closed in the last CLOSED_DAYS days; loaded when the Closed view is first opened. */
  closed: WorkItem[] | null
  closedLoading: boolean
  closedError: string | null
  /** The tab shown, and the project the lists are narrowed to (null for all); remembered per organization. */
  tab: MineTab
  project: string | null
  /** Assigned to others shows open work or what has closed. */
  othersMode: 'open' | 'closed'
  loading: boolean
  error: string | null
  lastLoaded: number | null
  types: TypesByProject
  planning: PlanningByProject
  /** People per project name, loaded when an item from a project other than the selected one is opened. */
  members: Record<string, Identity[]>
  /** Requirements, features and epics are listed too; off by default, remembered. */
  showPlanning: boolean
  search: string
  /** When My Work was last looked at; changes by others after this count toward the badge. */
  seenAt: number | null
  /** The previous seenAt while the view is open, so rows changed since the last visit stay marked. */
  highlightSince: number | null
  /** Fetch from the server; the cached copy is shown first on a cold start. */
  load(opts?: { silent?: boolean }): Promise<void>
  loadTypes(projects: string[]): Promise<void>
  loadMembers(project: string): Promise<void>
  setSearch(q: string): void
  setTab(tab: MineTab): void
  setProject(project: string | null): void
  setOthersMode(mode: 'open' | 'closed'): void
  loadClosed(opts?: { silent?: boolean }): Promise<void>
  setShowPlanning(show: boolean): void
  /** Call when the view opens (entering) and closes. */
  markSeen(entering: boolean): void
  upsert(it: WorkItem): void
  remove(id: number): void
}

export const useMyWorkStore = create<MyWorkState>((set, get) => ({
  org: null,
  items: null,
  others: null,
  closed: null,
  closedLoading: false,
  closedError: null,
  tab: 'active',
  project: null,
  othersMode: 'open',
  loading: false,
  error: null,
  lastLoaded: null,
  types: {},
  planning: {},
  members: {},
  showPlanning: readShowPlanning(),
  search: '',
  seenAt: null,
  highlightSince: null,

  load: async (opts) => {
    const org = useAppStore.getState().activeOrg
    if (!org) { set({ org: null, items: null, others: null, closed: null, error: null, types: {}, planning: {}, members: {} }); return }
    if (loadingOrg === org) return
    const fresh = get().org !== org
    if (fresh) {
      // First run in this organization starts the clock now, so the badge does not count everything at once.
      // Opening the view (markSeen) moves the clock on and keeps this value for the unseen dots.
      const seen = readSeen(org) ?? Date.now()
      writeSeen(org, seen)
      set({ org, items: null, others: null, closed: null, closedError: null, error: null, types: {}, planning: {}, members: {}, search: '', seenAt: seen, highlightSince: null, tab: readTab(org), project: readOrgKey('mine.project', org), othersMode: 'open' })
    }
    loadingOrg = org
    set({ loading: true, ...(opts?.silent ? {} : { error: null }) })
    if (fresh || get().items === null) {
      const [cached, cachedOthers] = await Promise.all([
        api().cacheGet<WorkItem[]>(`${org}/mine`).catch(() => null),
        api().cacheGet<WorkItem[]>(`${org}/mine-others`).catch(() => null),
      ])
      if (cached?.value && get().items === null) set({ items: cached.value })
      if (cachedOthers?.value && get().others === null) set({ others: cachedOthers.value })
    }
    // Work handed to others loads alongside; if it fails, My Work shows without that section.
    const others = api().assignedToOthers(org).then((res) => {
      if (useAppStore.getState().activeOrg !== org) return
      set({ others: res })
      void api().cacheSet(`${org}/mine-others`, res)
      void get().loadTypes([...new Set(res.map(projectOf))])
    }).catch(() => undefined)
    // A refresh keeps the Closed view current once it has been opened.
    if (!fresh && get().closed !== null) void get().loadClosed({ silent: true })
    try {
      const res = await api().myWork(org)
      if (useAppStore.getState().activeOrg !== org) return
      set({ items: res, error: null, lastLoaded: Date.now() })
      void api().cacheSet(`${org}/mine`, res)
      void get().loadTypes([...new Set(res.map(projectOf))])
    } catch (e) {
      if (!opts?.silent || get().items === null) set({ error: errorMessage(e) })
    } finally {
      await others
      if (loadingOrg === org) { loadingOrg = null; set({ loading: false }) }
    }
  },

  loadTypes: async (projects) => {
    const org = get().org
    if (!org) return
    const missing = projects.filter((p) => p && !get().types[p])
    const noPlanning = projects.filter((p) => p && !(p in get().planning))
    await Promise.all([
      ...missing.map(async (p) => {
        try {
          const list = await api().workItemTypes(org, p)
          if (get().org === org) set((s) => ({ types: { ...s.types, [p]: list } }))
        } catch { /* colours and state menus fall back to plain text for this project */ }
      }),
      ...noPlanning.map(async (p) => {
        try {
          const list = await api().planningTypes(org, p)
          if (get().org === org) set((s) => ({ planning: { ...s.planning, [p]: list } }))
        } catch {
          // The usual planning type names stand in for this project; recorded so a refresh does not ask again.
          if (get().org === org) set((s) => ({ planning: { ...s.planning, [p]: null } }))
        }
      }),
    ])
  },

  loadMembers: async (project) => {
    const org = useAppStore.getState().activeOrg
    if (!org || !project || get().members[project]) return
    try {
      // The members call takes a project name as well as an id.
      const list = await api().prProjectMembers(org, project)
      if (useAppStore.getState().activeOrg === org) set((s) => ({ members: { ...s.members, [project]: list } }))
    } catch { /* the picker offers only Unassigned for this project */ }
  },

  setSearch: (search) => set({ search }),
  setTab: (tab) => { writeOrgKey('mine.tab', get().org, tab); set({ tab }) },
  setProject: (project) => { writeOrgKey('mine.project', get().org, project); set({ project }) },
  setOthersMode: (othersMode) => {
    set({ othersMode })
    if (othersMode === 'closed' && get().closed === null) void get().loadClosed()
  },

  loadClosed: async (opts) => {
    const org = get().org
    if (!org || get().closedLoading) return
    set({ closedLoading: true, ...(opts?.silent ? {} : { closedError: null }) })
    try {
      const res = await api().closedByOthers(org, CLOSED_DAYS)
      if (get().org !== org) return
      set({ closed: res, closedError: null })
      void get().loadTypes([...new Set(res.map(projectOf))])
    } catch (e) {
      if (get().org === org && (!opts?.silent || get().closed === null)) set({ closedError: errorMessage(e) })
    } finally {
      if (get().org === org) set({ closedLoading: false })
    }
  },
  setShowPlanning: (showPlanning) => {
    try { localStorage.setItem(PLANNING_KEY, showPlanning ? '1' : '0') } catch { /* remembered for this session only */ }
    set({ showPlanning })
  },

  markSeen: (entering) => {
    const { org, seenAt } = get()
    if (!org) return
    const now = Date.now()
    writeSeen(org, now)
    set(entering ? { seenAt: now, highlightSince: seenAt } : { seenAt: now })
  },

  upsert: (it) => {
    const merge = (list: WorkItem[] | null) => (list ? list.map((x) => (x.id === it.id ? { ...x, ...it, fields: { ...x.fields, ...it.fields } } : x)) : list)
    set((s) => ({ items: merge(s.items), others: merge(s.others), closed: merge(s.closed) }))
  },
  remove: (id) => set((s) => ({ items: s.items ? s.items.filter((x) => x.id !== id) : s.items, others: s.others ? s.others.filter((x) => x.id !== id) : s.others, closed: s.closed ? s.closed.filter((x) => x.id !== id) : s.closed })),
}))
