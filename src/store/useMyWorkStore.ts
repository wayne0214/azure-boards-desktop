import { create } from 'zustand'
import { api } from '@/lib/api'
import type { WorkItem, WorkItemType, WorkItemTypeState } from '@/lib/types'
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

const isResolved = (it: WorkItem, types: TypesByProject) => {
  const c = stateCategory(it, types)
  return c ? c === 'Resolved' : it.fields['System.State'] === 'Resolved'
}

/**
 * Resolved and reported by me (for a bug, its "Reported by" is its creator): it waits for my check before it closes.
 * Only processes with a Resolved state (Agile, CMMI) have these.
 */
export const isToVerify = (it: WorkItem, types: TypesByProject, me = useAppStore.getState().account()) =>
  isResolved(it, types) && isMe(it.fields['System.CreatedBy'], me)

/** Resolved, assigned to me, but reported by someone else: the next step is theirs, so it leaves my list. */
export const isWaitingOnReporter = (it: WorkItem, types: TypesByProject, me = useAppStore.getState().account()) =>
  isResolved(it, types) && !isMe(it.fields['System.CreatedBy'], me)

/** Changed by someone else after the given time. */
export const isUnseen = (it: WorkItem, since: number | null, me = useAppStore.getState().account()) => {
  if (since === null) return false
  const changed = Date.parse(String(it.fields['System.ChangedDate'] ?? ''))
  return changed > since && !isMe(it.fields['System.ChangedBy'], me)
}

/** What the sidebar badge counts: items to verify, plus items someone else changed since My Work was last opened. */
export function attentionCount(items: WorkItem[] | null, types: TypesByProject, seenAt: number | null) {
  const me = useAppStore.getState().account()
  return (items ?? []).filter((it) => !isFinished(it, types) && !isWaitingOnReporter(it, types, me) && (isToVerify(it, types, me) || isUnseen(it, seenAt, me))).length
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

/** The organization a load is running for; a load for another organization must not wait behind it. */
let loadingOrg: string | null = null

interface MyWorkState {
  org: string | null
  items: WorkItem[] | null
  loading: boolean
  error: string | null
  lastLoaded: number | null
  types: TypesByProject
  search: string
  /** When My Work was last looked at; changes by others after this count toward the badge. */
  seenAt: number | null
  /** The previous seenAt while the view is open, so rows changed since the last visit stay marked. */
  highlightSince: number | null
  /** Fetch from the server; the cached copy is shown first on a cold start. */
  load(opts?: { silent?: boolean }): Promise<void>
  loadTypes(projects: string[]): Promise<void>
  setSearch(q: string): void
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
  search: '',
  seenAt: null,
  highlightSince: null,

  load: async (opts) => {
    const org = useAppStore.getState().activeOrg
    if (!org) { set({ org: null, items: null, error: null, types: {} }); return }
    if (loadingOrg === org) return
    const fresh = get().org !== org
    if (fresh) {
      // First run in this organization starts the clock now, so the badge does not count everything at once.
      // Opening the view (markSeen) moves the clock on and keeps this value for the unseen dots.
      const seen = readSeen(org) ?? Date.now()
      writeSeen(org, seen)
      set({ org, items: null, error: null, types: {}, search: '', seenAt: seen, highlightSince: null })
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
    await Promise.all(missing.map(async (p) => {
      try {
        const list = await api().workItemTypes(org, p)
        if (get().org === org) set((s) => ({ types: { ...s.types, [p]: list } }))
      } catch { /* colours and state menus fall back to plain text for this project */ }
    }))
  },

  setSearch: (search) => set({ search }),

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
