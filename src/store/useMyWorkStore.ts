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

const PLANNING_KEY = 'mine.showPlanning'
const readShowPlanning = () => { try { return localStorage.getItem(PLANNING_KEY) === '1' } catch { return false } }

/** The organization a load is running for; a load for another organization must not wait behind it. */
let loadingOrg: string | null = null

interface MyWorkState {
  org: string | null
  items: WorkItem[] | null
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
  setShowPlanning(show: boolean): void
  /** Call when the view opens (entering) and closes. */
  markSeen(entering: boolean): void
  upsert(it: WorkItem): void
  remove(id: number): void
}

export const useMyWorkStore = create<MyWorkState>((set, get) => ({
  org: null,
  items: null,
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
    if (!org) { set({ org: null, items: null, error: null, types: {}, planning: {}, members: {} }); return }
    if (loadingOrg === org) return
    const fresh = get().org !== org
    if (fresh) {
      // First run in this organization starts the clock now, so the badge does not count everything at once.
      // Opening the view (markSeen) moves the clock on and keeps this value for the unseen dots.
      const seen = readSeen(org) ?? Date.now()
      writeSeen(org, seen)
      set({ org, items: null, error: null, types: {}, planning: {}, members: {}, search: '', seenAt: seen, highlightSince: null })
    }
    loadingOrg = org
    set({ loading: true, ...(opts?.silent ? {} : { error: null }) })
    if (fresh || get().items === null) {
      const cached = await api().cacheGet<WorkItem[]>(`${org}/mine`).catch(() => null)
      if (cached?.value && get().items === null) set({ items: cached.value })
    }
    try {
      const res = await api().myWork(org)
      if (useAppStore.getState().activeOrg !== org) return
      set({ items: res, error: null, lastLoaded: Date.now() })
      void api().cacheSet(`${org}/mine`, res)
      void get().loadTypes([...new Set(res.map(projectOf))])
    } catch (e) {
      if (!opts?.silent || get().items === null) set({ error: errorMessage(e) })
    } finally {
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

  upsert: (it) => set((s) => ({ items: s.items ? s.items.map((x) => (x.id === it.id ? { ...x, ...it, fields: { ...x.fields, ...it.fields } } : x)) : s.items })),
  remove: (id) => set((s) => ({ items: s.items ? s.items.filter((x) => x.id !== id) : s.items })),
}))
