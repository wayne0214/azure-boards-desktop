import { create } from 'zustand'
import { api } from '@/lib/api'
import { AFFECTS, disciplineOf, parentIdOfItem, reqConfig, titleWithoutPrefix, type Discipline, type ReqConfig } from '@/lib/requirements'
import { tagsOf } from '@/lib/format'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { useBoardStore } from './useBoardStore'
import { useUiStore } from './useUiStore'

export type ReqFilter = 'all' | 'gaps' | 'changes' | 'recent' | 'mine'
export type ReqMode = 'outline' | 'document'

/** Where a new row is being typed: under `parentId` (null = a new UN), at tier `level`. */
export interface Draft {
  parentId: number | null
  level: 0 | 1 | 2
  /** The row the draft sits after, for placing it in the outline. */
  afterId: number | null
}

const OPEN_BUG_EXCLUDE = ['Closed', 'Resolved', 'Done', 'Removed', 'Completed']

const readSet = (key: string): Set<number> => {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as number[]) } catch { return new Set() }
}
const writeSet = (key: string, s: Set<number>) => { try { localStorage.setItem(key, JSON.stringify([...s])) } catch { /* ignore */ } }
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

interface ReqState {
  project: string | null
  cfg: ReqConfig | null
  items: WorkItem[]
  bugs: WorkItem[]
  /** Tasks in the project; those under an SRS show as its build progress. */
  tasks: WorkItem[]
  /** SRS rows whose task list is open (closed by default to keep the outline about requirements). */
  tasksOpen: Set<number>
  /** A task being typed under an SRS. */
  taskDraft: { parentId: number; discipline: Discipline | null } | null
  /** Open change requests and issues, with their links. */
  changes: WorkItem[]
  issues: WorkItem[]
  /** A change request being typed for a requirement. */
  crDraft: { targetId: number } | null
  loading: boolean
  error: string | null
  loadedAt: number | null
  /** Collapsed rows; everything starts open so the whole structure is visible. */
  collapsed: Set<number>
  filter: ReqFilter
  search: string
  mode: ReqMode
  selectedId: number | null
  draft: Draft | null
  saving: boolean

  load(opts?: { silent?: boolean }): Promise<void>
  toggle(id: number): void
  setCollapsedAll(ids: number[]): void
  setFilter(f: ReqFilter): void
  setSearch(s: string): void
  setMode(m: ReqMode): void
  select(id: number | null): void
  open(id: number): void
  startDraft(d: Draft | null): void
  createFromDraft(title: string, reqId: string): Promise<boolean>
  startCrDraft(d: { targetId: number } | null): void
  /** Create a change request that Affects the draft's requirement. */
  createChange(title: string): Promise<boolean>
  /** Apply the cleanup: turn items into tasks, or keep a CR and link it with Affects instead of as a child. */
  applyReview(plan: { item: WorkItem; action: 'task' | 'affects' }[]): Promise<number>
  toggleTasks(id: number): void
  startTaskDraft(d: { parentId: number; discipline: Discipline | null } | null): void
  createTask(title: string, discipline: Discipline | null): Promise<boolean>
  /** Tasks still marked by a "[FE]" title prefix instead of a tag. */
  untaggedPrefixed(): WorkItem[]
  /** Move "[FE]" prefixes into tags for the given tasks; returns how many changed. */
  tagPrefixed(tasks: WorkItem[]): Promise<number>
  /** Replace an item edited elsewhere (details panel) so the tree shows it at once. */
  merge(item: WorkItem): void
  /** Set how an SRS is verified (Test, Inspection, Analysis, Demonstration). */
  setMethod(id: number, value: string): Promise<void>
}

export const useReqStore = create<ReqState>((set, get) => ({
  project: null,
  cfg: null,
  items: [],
  bugs: [],
  tasks: [],
  tasksOpen: new Set(),
  taskDraft: null,
  changes: [],
  issues: [],
  crDraft: null,
  loading: false,
  error: null,
  loadedAt: null,
  collapsed: new Set(),
  filter: 'all',
  search: '',
  mode: ((): ReqMode => { try { return localStorage.getItem('req.mode') === 'document' ? 'document' : 'outline' } catch { return 'outline' } })(),
  selectedId: null,
  draft: null,
  saving: false,

  load: async (opts) => {
    const org = useAppStore.getState().activeOrg
    const project = useAppStore.getState().selectedProject?.name ?? null
    const ctx = useBoardStore.getState().ctx
    const cfg = reqConfig(ctx)
    if (!org || !project) return
    // Switching project starts from a clean slate, with that project's remembered folds.
    if (project !== get().project) {
      set({ project, items: [], bugs: [], tasks: [], changes: [], issues: [], crDraft: null, tasksOpen: new Set(), taskDraft: null, selectedId: null, draft: null, error: null, loadedAt: null, collapsed: readSet(`req.collapsed.${org}/${project}`) })
    }
    set({ cfg })
    if (!opts?.silent) set({ loading: true, error: null })
    try {
      // Without a UN > DI > SRS hierarchy there are no requirements, but tasks and bugs still load for the Team page.
      const types = cfg ? cfg.tiers.map((t) => t.type.name) : []
      const hasType = (n: string) => !!ctx?.workItemTypes.some((t) => t.name === n && !t.isDisabled)
      const crTypes = ['Change Request', 'Issue'].filter(hasType)
      const [items, bugs, tasks, crs] = await Promise.all([
        cfg ? api().projectItems(org, project, types, [], cfg.extraFields) : Promise.resolve([] as WorkItem[]),
        api().projectItems(org, project, ['Bug'], OPEN_BUG_EXCLUDE, []).catch(() => [] as WorkItem[]),
        api().projectItems(org, project, ['Task'], [], []).catch(() => [] as WorkItem[]),
        // Links matter here (Affects, blocks), so these come with their relations.
        crTypes.length ? api().projectItems(org, project, crTypes, OPEN_BUG_EXCLUDE, [], true).catch(() => [] as WorkItem[]) : Promise.resolve([] as WorkItem[]),
      ])
      if (get().project !== project) return
      const changes = crs.filter((w) => w.fields['System.WorkItemType'] === 'Change Request')
      const issues = crs.filter((w) => w.fields['System.WorkItemType'] === 'Issue')
      set({ items, bugs, tasks, changes, issues, loading: false, error: null, loadedAt: Date.now() })
    } catch (e) {
      if (get().project === project) set({ loading: false, error: errorText(e) })
    }
  },

  toggle: (id) => {
    const next = new Set(get().collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ collapsed: next })
    const org = useAppStore.getState().activeOrg
    if (org && get().project) writeSet(`req.collapsed.${org}/${get().project}`, next)
  },
  setCollapsedAll: (ids) => {
    const next = new Set(ids)
    set({ collapsed: next })
    const org = useAppStore.getState().activeOrg
    if (org && get().project) writeSet(`req.collapsed.${org}/${get().project}`, next)
  },
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  setMode: (mode) => { try { localStorage.setItem('req.mode', mode) } catch { /* ignore */ } set({ mode, draft: null }) },
  select: (selectedId) => set({ selectedId }),
  open: (id) => {
    set({ selectedId: id })
    // Requirements, their tasks and bugs all open in the same details panel.
    const { items, tasks, bugs, changes, issues } = get()
    const item = [items, tasks, bugs, changes, issues].map((l) => l.find((i) => i.id === id)).find(Boolean)
    if (!item) return
    void useBoardStore.getState().openItem(item)
    useUiStore.getState().toggleInspector(true)
  },

  startDraft: (draft) => {
    // Opening a draft under a folded row unfolds it so the new row is visible.
    if (draft?.parentId != null && get().collapsed.has(draft.parentId)) get().toggle(draft.parentId)
    set({ draft, taskDraft: null })
  },

  createFromDraft: async (title, reqId) => {
    const { draft, cfg, project } = get()
    const org = useAppStore.getState().activeOrg
    if (!draft || !cfg || !org || !project || !title.trim() || get().saving) return false
    const tier = cfg.tiers[draft.level]
    const fields: Record<string, unknown> = { 'System.Title': title.trim() }
    if (tier.idField && reqId.trim()) fields[tier.idField.referenceName] = reqId.trim()
    set({ saving: true })
    try {
      const created = await api().createWorkItem(org, project, tier.type.name, fields, draft.parentId)
      // The create response may not carry every field we show; keep what we sent.
      const item: WorkItem = { ...created, fields: { ...fields, ...created.fields, 'System.Parent': draft.parentId ?? undefined } }
      set((s) => ({ items: [...s.items, item], saving: false, selectedId: item.id, draft: { ...draft, afterId: item.id } }))
      return true
    } catch (e) {
      set({ saving: false })
      useUiStore.getState().toast({ kind: 'error', title: `Could not add the ${tier.label}`, detail: errorText(e) })
      return false
    }
  },

  startCrDraft: (crDraft) => set({ crDraft, draft: null, taskDraft: null }),

  createChange: async (title) => {
    const { crDraft, project } = get()
    const org = useAppStore.getState().activeOrg
    if (!crDraft || !org || !project || !title.trim() || get().saving) return false
    set({ saving: true })
    try {
      const created = await api().createWorkItem(org, project, 'Change Request', { 'System.Title': title.trim() }, null)
      const linked = await api().addLink(org, project, created.id, crDraft.targetId, AFFECTS)
      set((s) => ({ changes: [...s.changes, { ...linked, fields: { ...created.fields, ...linked.fields } }], saving: false, crDraft: null }))
      useUiStore.getState().toast({ kind: 'success', title: `Change request #${created.id} created`, detail: 'Open it to describe the change and its impact.', action: { label: 'Open', onClick: () => get().open(created.id) } })
      return true
    } catch (e) {
      set({ saving: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create the change request', detail: errorText(e) })
      return false
    }
  },

  applyReview: async (plan) => {
    const { project } = get()
    const org = useAppStore.getState().activeOrg
    if (!org || !project) return 0
    let done = 0
    for (const { item, action } of plan) {
      try {
        if (action === 'task') {
          // Becomes a Task; an "[FE]" title prefix moves into a tag on the way.
          const d = disciplineOf(item)
          const fields: Record<string, unknown> = { 'System.WorkItemType': 'Task' }
          if (d.d && d.fromPrefix) {
            fields['System.Title'] = titleWithoutPrefix(String(item.fields['System.Title'] ?? ''))
            fields['System.Tags'] = [...new Set([...tagsOf(item), d.d])].join('; ')
          }
          await api().updateWorkItem(org, project, item.id, item.rev ?? null, fields)
        } else {
          const p = parentIdOfItem(item)
          if (p === null) continue
          await api().addLink(org, project, item.id, p, AFFECTS)
          await api().setParent(org, project, item.id, null)
        }
        done++
      } catch (e) {
        useUiStore.getState().toast({ kind: 'error', title: `Could not update #${item.id}`, detail: errorText(e) })
      }
    }
    await get().load({ silent: true })
    return done
  },

  toggleTasks: (id) => set((s) => {
    const next = new Set(s.tasksOpen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { tasksOpen: next }
  }),
  startTaskDraft: (d) => set((s) => (d ? { taskDraft: d, draft: null, tasksOpen: new Set([...s.tasksOpen, d.parentId]) } : { taskDraft: null })),

  createTask: async (title, discipline) => {
    const { taskDraft, project } = get()
    const org = useAppStore.getState().activeOrg
    if (!taskDraft || !org || !project || !title.trim() || get().saving) return false
    const fields: Record<string, unknown> = { 'System.Title': titleWithoutPrefix(title.trim()) }
    if (discipline) fields['System.Tags'] = discipline
    set({ saving: true })
    try {
      const created = await api().createWorkItem(org, project, 'Task', fields, taskDraft.parentId)
      const task: WorkItem = { ...created, fields: { ...fields, ...created.fields, 'System.Parent': taskDraft.parentId } }
      set((s) => ({ tasks: [...s.tasks, task], saving: false, taskDraft: { ...taskDraft, discipline } }))
      return true
    } catch (e) {
      set({ saving: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not add the task', detail: errorText(e) })
      return false
    }
  },

  untaggedPrefixed: () => get().tasks.filter((t) => disciplineOf(t).fromPrefix),

  tagPrefixed: async (list) => {
    const { project } = get()
    const org = useAppStore.getState().activeOrg
    if (!org || !project) return 0
    let changed = 0
    for (const t of list) {
      const d = disciplineOf(t).d
      if (!d) continue
      const tags = [...new Set([...tagsOf(t), d])].join('; ')
      try {
        const updated = await api().updateWorkItem(org, project, t.id, t.rev ?? null, { 'System.Title': titleWithoutPrefix(String(t.fields['System.Title'] ?? '')), 'System.Tags': tags })
        set((s) => ({ tasks: s.tasks.map((x) => (x.id === t.id ? { ...updated, fields: { ...x.fields, ...updated.fields } } : x)) }))
        changed++
      } catch (e) {
        useUiStore.getState().toast({ kind: 'error', title: `Could not update #${t.id}`, detail: errorText(e) })
      }
    }
    return changed
  },

  setMethod: async (id, value) => {
    const org = useAppStore.getState().activeOrg
    const { project, cfg, items } = get()
    const item = items.find((i) => i.id === id)
    if (!org || !project || !cfg?.methodField || !item) return
    try {
      const updated = await api().updateWorkItem(org, project, id, item.rev ?? null, { [cfg.methodField.referenceName]: value || null })
      get().merge(updated)
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not set the verification method', detail: errorText(e) })
    }
  },

  merge: (item) => set((s) => {
    const fresh = (list: WorkItem[]) => {
      const i = list.findIndex((x) => x.id === item.id)
      if (i < 0 || (list[i].rev ?? 0) > (item.rev ?? 0)) return null
      const next = list.slice()
      next[i] = { ...item, fields: { ...list[i].fields, ...item.fields } }
      return next
    }
    for (const key of ['items', 'tasks', 'changes', 'issues'] as const) {
      const next = fresh(s[key])
      if (next) return { [key]: next }
    }
    return {}
  }),
}))

// Edits made in the details panel arrive in the board store; mirror them into the tree.
useBoardStore.subscribe((s, prev) => {
  if (s.detached && s.detached !== prev.detached) useReqStore.getState().merge(s.detached)
  // Items that are also on the open board are edited in place there.
  if (s.items !== prev.items && s.selectedId !== null) {
    const it = s.items.find((i) => i.id === s.selectedId)
    if (it) useReqStore.getState().merge(it)
  }
})

/** Load the project's requirements, tasks and bugs once its process is known; shared by Requirements and Team. */
export function ensureReqLoaded(projectName: string, ctx: Parameters<typeof reqConfig>[0]): void {
  const st = useReqStore.getState()
  // Also reload when the process context changed under us (it arrives after a project switch).
  const sig = (c: ReturnType<typeof reqConfig>) => (c ? c.tiers.map((t) => t.type.name).join() + c.extraFields.join() : '')
  if (st.project !== projectName || !st.loadedAt || sig(st.cfg) !== sig(reqConfig(ctx))) void st.load()
}
