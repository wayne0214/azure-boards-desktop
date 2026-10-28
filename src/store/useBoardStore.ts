import { create } from 'zustand'
import { api } from '@/lib/api'
import { allCustomFieldRefs } from '@/lib/customFields'
import { boardFields, boardTypes, doneStates, identityKey } from '@/lib/format'
import type { Board, BoardColumn, Identity, TeamContext, WorkItem, WorkItemType } from '@/lib/types'
import { errorMessage, isAppError } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

export interface Filters {
  search: string
  mine: boolean
  types: string[]
  tags: string[]
  assignees: string[]
  iterationPath: string | null
}

interface BoardState {
  key: string | null
  board: Board | null
  ctx: TeamContext | null
  items: WorkItem[]
  loading: boolean
  refreshing: boolean
  error: string | null
  lastUpdated: number | null
  fromCache: boolean
  selectedId: number | null
  selectedIds: Set<number>
  /** An item shown in the inspector that is not on the current board (a parent, a My Work row, a search hit). */
  detached: WorkItem | null
  history: number[]
  filters: Filters
  pending: Set<number>

  load(): Promise<void>
  refresh(opts?: { silent?: boolean }): Promise<void>
  setFilters(patch: Partial<Filters>): void
  clearFilters(): void
  select(id: number | null, opts?: { additive?: boolean; range?: boolean }): void
  selectMany(ids: number[]): void
  clearSelection(): void
  /** Show any work item in the inspector, fetching it if it is not on the board. */
  openItem(target: number | WorkItem, opts?: { project?: string; push?: boolean | 'keep' }): Promise<void>
  goBack(): void
  getItem(id: number): WorkItem | undefined
  upsert(item: WorkItem): void
  moveToColumn(id: number, columnName: string, done?: boolean): Promise<void>
  updateFields(id: number, fields: Record<string, unknown>, opts?: { optimistic?: Record<string, unknown> }): Promise<WorkItem | null>
  /** `people` is who `who` is looked up in; the board's team unless the item is from another project. */
  assign(id: number, who: string | null, people?: Identity[]): Promise<void>
  bulkUpdate(ids: number[], fields: Record<string, unknown>): Promise<void>
  create(type: string, fields: Record<string, unknown>, parentId: number | null): Promise<WorkItem | null>
  remove(id: number): Promise<void>
  reloadItem(id: number): Promise<WorkItem | null>
}

const emptyFilters: Filters = { search: '', mine: false, types: [], tags: [], assignees: [], iterationPath: null }

function cacheKey(org: string, project: string, team: string, boardId: string) {
  return `${org}/${project}/${team}/${boardId}`
}

export const VIRTUAL_PREFIX = 'virtual:'

/** Build a state-per-column board for a type Azure DevOps does not put on a Kanban board. */
export function buildVirtualBoard(type: WorkItemType): Board {
  const states = type.states.filter((s) => s.category !== 'Removed')
  const columns: BoardColumn[] = states.map((s, i) => ({
    id: `${type.name}:${s.name}`,
    name: s.name,
    itemLimit: 0,
    stateMappings: { [type.name]: s.name },
    columnType: s.category === 'Proposed' || i === 0 ? 'incoming' : s.category === 'Completed' ? 'outgoing' : 'inProgress',
  }))
  return {
    id: `${VIRTUAL_PREFIX}${type.name}`,
    name: `${type.name}s`.replace(/ys$/, 'ies'),
    columns,
    rows: [{ id: null, name: null }],
    fields: { columnField: { referenceName: 'App.Virtual.Column' }, doneField: { referenceName: 'App.Virtual.Done' } },
    allowedMappings: {},
    canEdit: true,
    virtual: true,
  }
}

export function projectOf(item: WorkItem): string {
  return String(item.fields['System.TeamProject'] ?? useAppStore.getState().selectedProject?.name ?? '')
}

export const useBoardStore = create<BoardState>((set, get) => ({
  key: null,
  board: null,
  ctx: null,
  items: [],
  loading: false,
  refreshing: false,
  error: null,
  lastUpdated: null,
  fromCache: false,
  selectedId: null,
  selectedIds: new Set(),
  detached: null,
  history: [],
  filters: { ...emptyFilters },
  pending: new Set(),

  getItem: (id) => {
    const s = get()
    return s.items.find((i) => i.id === id) ?? (s.detached?.id === id ? s.detached : undefined)
  },

  load: async () => {
    const { activeOrg: org, selectedProject: project, selectedTeam: team, selectedBoardId: boardId } = useAppStore.getState()
    if (!org || !project || !team || !boardId) {
      set({ key: null, board: null, ctx: null, items: [], error: null, selectedId: null, selectedIds: new Set(), detached: null, history: [] })
      return
    }
    const key = cacheKey(org, project.id, team.id, boardId)
    if (get().key === key) return
    set({ key, board: null, ctx: null, items: [], loading: true, error: null, selectedId: null, selectedIds: new Set(), detached: null, history: [], filters: { ...emptyFilters }, fromCache: false })
    useUiStore.getState().toggleInspector(false)

    const cached = await api().cacheGet<{ board: Board; ctx: TeamContext; items: WorkItem[] }>(key).catch(() => null)
    if (cached?.value && get().key === key) {
      set({ board: cached.value.board, ctx: cached.value.ctx, items: cached.value.items, lastUpdated: cached.updatedAt * 1000, fromCache: true, loading: false })
    }
    try {
      const isVirtual = boardId.startsWith(VIRTUAL_PREFIX)
      const [boardRes, ctx] = await Promise.all([
        isVirtual ? Promise.resolve(null) : api().getBoard(org, project.name, team.name, boardId),
        api().getTeamContext(org, project.id, project.name, team.name),
      ])
      if (get().key !== key) return
      let board = boardRes
      if (isVirtual) {
        const typeName = boardId.slice(VIRTUAL_PREFIX.length)
        const type = ctx.workItemTypes.find((t) => t.name === typeName)
        if (!type) throw new Error(`The work item type “${typeName}” is not in this project.`)
        board = buildVirtualBoard(type)
      }
      set({ board, ctx })
      await get().refresh({ silent: true })
    } catch (e) {
      if (get().key !== key) return
      set({ loading: false, error: errorMessage(e) })
    }
  },

  refresh: async (opts) => {
    const { activeOrg: org, selectedProject: project, selectedTeam: team } = useAppStore.getState()
    const { board, key, ctx } = get()
    if (!org || !project || !team || !board || !key) return
    set(opts?.silent ? { refreshing: true } : { refreshing: true, error: null })
    try {
      const f = boardFields(board)
      const types = boardTypes(board)
      const items = await api().queryBoardItems(org, {
        project: project.name,
        team: team.name,
        types,
        doneStates: doneStates(board),
        doneDays: useUiStore.getState().doneDays,
        extraFields: [...(board.virtual ? [] : [f.column, f.row, f.done]), ...allCustomFieldRefs(ctx, types)],
        iterationPath: null,
      })
      if (get().key !== key) return
      const shown = new Map(get().items.map((i) => [i.id, i]))
      set({ items: items.map((i) => keepUnsaved(i, shown.get(i.id))), loading: false, refreshing: false, lastUpdated: Date.now(), fromCache: false, error: null })
      void api().cacheSet(key, { board, ctx, items }).catch(() => undefined)
    } catch (e) {
      if (get().key !== key) return
      set({ loading: false, refreshing: false, error: get().items.length ? null : errorMessage(e) })
      if (get().items.length) useUiStore.getState().toast({ kind: 'error', title: 'Refresh failed', detail: errorMessage(e) })
    }
  },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clearFilters: () => set({ filters: { ...emptyFilters } }),

  select: (id, opts) => {
    if (id === null) {
      set({ selectedId: null, selectedIds: new Set(), detached: null, history: [] })
      return
    }
    const { selectedIds, selectedId } = get()
    if (opts?.additive) {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ selectedId: id, selectedIds: next })
      return
    }
    if (opts?.range && selectedId !== null) {
      const next = new Set(selectedIds)
      next.add(id)
      set({ selectedId: id, selectedIds: next })
      return
    }
    set({ selectedId: id, selectedIds: new Set([id]), detached: null, history: [] })
    useUiStore.getState().toggleInspector(true)
  },
  selectMany: (ids) => set({ selectedIds: new Set(ids), selectedId: ids[ids.length - 1] ?? null }),
  clearSelection: () => set({ selectedId: null, selectedIds: new Set(), detached: null, history: [] }),

  openItem: async (target, opts) => {
    const org = useAppStore.getState().activeOrg
    if (!org) return
    const id = typeof target === 'number' ? target : target.id
    const prev = get().selectedId
    // Only navigating from inside the panel (parent / child links) builds a back trail.
    const history = opts?.push === true && prev !== null && prev !== id ? [...get().history, prev] : opts?.push === 'keep' ? get().history : []
    const onBoard = get().items.find((i) => i.id === id)
    if (onBoard) {
      set({ selectedId: id, selectedIds: new Set([id]), detached: null, history })
      useUiStore.getState().toggleInspector(true)
      return
    }
    if (typeof target === 'object') {
      set({ selectedId: id, selectedIds: new Set(), detached: target, history })
      useUiStore.getState().toggleInspector(true)
    }
    const project = opts?.project ?? (typeof target === 'object' ? projectOf(target) : useAppStore.getState().selectedProject?.name)
    if (!project) return
    try {
      const fresh = await api().getWorkItem(org, project, id)
      if (get().selectedId === id) set({ detached: fresh, selectedIds: new Set() })
      if (typeof target === 'number') {
        set({ selectedId: id, selectedIds: new Set(), detached: fresh, history })
        useUiStore.getState().toggleInspector(true)
      }
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: `Could not open #${id}`, detail: errorMessage(e) })
    }
  },

  goBack: () => {
    const h = get().history
    if (h.length === 0) return
    const prev = h[h.length - 1]
    set({ history: h.slice(0, -1) })
    void get().openItem(prev, { push: 'keep' })
  },

  upsert: (item) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id)
      if (idx === -1) {
        if (s.detached?.id === item.id) return { detached: item }
        return { items: [item, ...s.items] }
      }
      const items = s.items.slice()
      items[idx] = item
      return { items }
    }),

  moveToColumn: async (id, columnName, done) => {
    const { board } = get()
    if (!board) return
    const item = get().getItem(id)
    if (!item) return
    const column = board.columns.find((c) => c.name === columnName)
    if (!column) return
    const f = boardFields(board)
    const type = String(item.fields['System.WorkItemType'] ?? '')
    const targetState = column.stateMappings?.[type]
    const fields: Record<string, unknown> = {}
    if (!board.virtual) {
      fields[f.column] = columnName
      if (column.isSplit) fields[f.done] = Boolean(done)
      else if (item.fields[f.done]) fields[f.done] = false
    }
    if (targetState && targetState !== item.fields['System.State']) fields['System.State'] = targetState
    if (Object.keys(fields).length === 0) return
    await get().updateFields(id, fields)
  },

  updateFields: async (id, fields, opts) => {
    const org = useAppStore.getState().activeOrg
    const first = get().getItem(id)
    if (!org || !first) return null
    const project = projectOf(first)
    const shown = (opts?.optimistic ?? fields) as Record<string, unknown>
    // What Azure DevOps last confirmed for this item; a failed edit falls back to it, not to another unsaved edit.
    if (!saveQueue.has(id)) confirmed.set(id, first)
    const overlay = { fields: shown }
    overlays.set(id, [...(overlays.get(id) ?? []), overlay])
    get().upsert(withFields(first, shown))
    set((s) => ({ pending: new Set(s.pending).add(id) }))

    // Saves of one item go one at a time, each with the revision the previous save returned,
    // so two quick edits do not trip Azure DevOps' "changed elsewhere" check on each other.
    const run = async (): Promise<WorkItem | null> => {
      const rev = get().getItem(id)?.rev ?? first.rev ?? null
      const later = () => (overlays.get(id) ?? []).filter((o) => o !== overlay)
      try {
        const updated = await api().updateWorkItem(org, project, id, rev, fields)
        overlays.set(id, later())
        const saved = mergeExtra(updated, get().getItem(id) ?? first)
        confirmed.set(id, saved)
        get().upsert(later().reduce<WorkItem>((it, o) => withFields(it, o.fields), saved))
        window.dispatchEvent(new CustomEvent('app:item-updated', { detail: updated }))
        return updated
      } catch (e) {
        overlays.set(id, later())
        const current = get().getItem(id)
        const base = confirmed.get(id) ?? first
        const restored = Object.fromEntries(Object.keys(shown).map((k) => [k, base.fields[k] ?? null]))
        if (current) get().upsert(later().reduce<WorkItem>((it, o) => withFields(it, o.fields), withFields(current, restored)))
        const ui = useUiStore.getState()
        if (isAppError(e) && e.kind === 'conflict') {
          ui.toast({ kind: 'error', title: 'Item changed elsewhere', detail: e.message, action: { label: 'Reload', onClick: () => void get().reloadItem(id) } })
        } else {
          ui.toast({ kind: 'error', title: 'Could not save', detail: errorMessage(e) })
        }
        return null
      }
    }
    const result = (saveQueue.get(id) ?? Promise.resolve()).then(run)
    const tail = result.then(() => undefined)
    saveQueue.set(id, tail)
    try {
      return await result
    } finally {
      if (saveQueue.get(id) === tail) {
        saveQueue.delete(id)
        overlays.delete(id)
        confirmed.delete(id)
        set((s) => {
          const pending = new Set(s.pending)
          pending.delete(id)
          return { pending }
        })
      }
    }
  },

  assign: async (id, who, people = get().ctx?.members) => {
    const member = who ? people?.find((m) => identityKey(m) === who || m.uniqueName === who || m.displayName === who) : null
    const optimistic = member
      ? { 'System.AssignedTo': { id: member.id, displayName: member.displayName, uniqueName: member.uniqueName ?? undefined } }
      : { 'System.AssignedTo': null }
    await get().updateFields(id, { 'System.AssignedTo': who ? (member?.uniqueName ?? who) : null }, { optimistic })
  },

  bulkUpdate: async (ids, fields) => {
    const ui = useUiStore.getState()
    let failed = 0
    for (const id of ids) {
      const res = await get().updateFields(id, fields)
      if (!res) failed += 1
    }
    if (failed === 0) ui.toast({ kind: 'success', title: ids.length === 1 ? 'Saved' : `Updated ${ids.length} items` })
    else ui.toast({ kind: 'error', title: `${failed} of ${ids.length} items could not be updated` })
  },

  create: async (type, fields, parentId) => {
    const { activeOrg: org, selectedProject: project } = useAppStore.getState()
    if (!org || !project) return null
    try {
      const created = await api().createWorkItem(org, project.name, type, fields, parentId)
      const { board } = get()
      if (board && boardTypes(board).includes(type)) get().upsert(created)
      return created
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create item', detail: errorMessage(e) })
      return null
    }
  },

  remove: async (id) => {
    const org = useAppStore.getState().activeOrg
    const item = get().getItem(id)
    if (!org || !item) return
    set((s) => ({ items: s.items.filter((i) => i.id !== id), selectedId: s.selectedId === id ? null : s.selectedId, detached: s.detached?.id === id ? null : s.detached }))
    try {
      await api().deleteWorkItem(org, projectOf(item), id)
      useUiStore.getState().toast({ kind: 'info', title: `#${id} moved to the recycle bin`, detail: 'You can restore it from Azure DevOps on the web.' })
    } catch (e) {
      // Put back only this item, so a refresh that landed meanwhile is kept.
      set((s) => ({ items: s.items.some((i) => i.id === id) ? s.items : [...s.items, item] }))
      useUiStore.getState().toast({ kind: 'error', title: 'Could not delete', detail: errorMessage(e) })
    }
  },

  reloadItem: async (id) => {
    const org = useAppStore.getState().activeOrg
    const existing = get().getItem(id)
    if (!org || !existing) return null
    try {
      const fresh = await api().getWorkItem(org, projectOf(existing), id)
      const merged = keepUnsaved(mergeExtra(fresh, existing), get().getItem(id))
      get().upsert(merged)
      return merged
    } catch {
      return null
    }
  },
}))

/** Saves waiting or in flight per item, chained so they run one at a time. */
const saveQueue = new Map<number, Promise<void>>()
/** Field values shown for edits of an item that have not been saved yet, oldest first. */
const overlays = new Map<number, { fields: Record<string, unknown> }[]>()
/** The item as Azure DevOps last confirmed it, while saves for it are queued. */
const confirmed = new Map<number, WorkItem>()

/**
 * A fresh copy of an item with a save still queued: keep whichever revision is newer (a refresh that started
 * before a save returned would bring back the older one) and show the unsaved edits on top.
 */
function keepUnsaved(fresh: WorkItem, current: WorkItem | undefined): WorkItem {
  const queued = overlays.get(fresh.id)
  if (!queued) return fresh
  const base = current && (current.rev ?? 0) > (fresh.rev ?? 0) ? current : fresh
  return queued.reduce<WorkItem>((it, o) => withFields(it, o.fields), base)
}

/** The item with these fields set; null removes a field. */
function withFields(item: WorkItem, fields: Record<string, unknown>): WorkItem {
  const next = { ...item.fields, ...fields } as WorkItem['fields']
  for (const [k, v] of Object.entries(fields)) if (v === null) delete next[k]
  return { ...item, fields: next }
}

/** Keep board-specific fields (WEF_*) if the API response omitted them. */
function mergeExtra(fresh: WorkItem, previous: WorkItem): WorkItem {
  const fields = { ...fresh.fields }
  for (const [k, v] of Object.entries(previous.fields)) {
    if (!(k in fields) && k.startsWith('WEF_')) fields[k] = v
  }
  return { ...fresh, fields }
}

useAppStore.subscribe((s, prev) => {
  if (
    s.activeOrg !== prev.activeOrg ||
    s.selectedProject?.id !== prev.selectedProject?.id ||
    s.selectedTeam?.id !== prev.selectedTeam?.id ||
    s.selectedBoardId !== prev.selectedBoardId
  ) {
    void useBoardStore.getState().load()
  }
})
