import { create } from 'zustand'
import { api } from '@/lib/api'
import { linkedIds, plainText } from '@/lib/requirements'
import { STEPS, TESTS_LINK, tcConfig, type TcConfig } from '@/lib/testcases/config'
import type { TcFilter } from '@/lib/testcases/coverage'
import type { PlannedCase } from '@/lib/testcases/importPlan'
import { nextSdvId, sdvAfterCreate } from '@/lib/testcases/sdv'
import { baselineRev, reviewMarks, specChangedSince, withReviewMark, type SpecChange } from '@/lib/testcases/review'
import { commentToRun, runToComment, type RunRecord } from '@/lib/testcases/run'
import { htmlFromPlain, parseSteps, serializeSteps, textToSteps, type StepItem } from '@/lib/testcases/steps'
import { isAppError, type TeamContext, type WorkItem } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { useBoardStore } from './useBoardStore'
import { useReqStore } from './useReqStore'
import { useUiStore } from './useUiStore'

export type TcMode = 'outline' | 'document' | 'run'
export type SaveState = 'saving' | 'saved' | 'failed'

const MODES: TcMode[] = ['outline', 'document', 'run']

const readSet = (key: string): Set<number> => {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as number[]) } catch { return new Set() }
}
const writeSet = (key: string, s: Set<number>) => { try { localStorage.setItem(key, JSON.stringify([...s])) } catch { /* ignore */ } }
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

interface TcState {
  project: string | null
  cfg: TcConfig | null
  tests: WorkItem[]
  shared: WorkItem[]
  loading: boolean
  error: string | null
  loadedAt: number | null
  mode: TcMode
  filter: TcFilter
  search: string
  selectedId: number | null
  /** Folded DI and SRS rows. */
  collapsed: Set<number>
  /** Per test case: how its last save went, for the "Saved to Azure DevOps" status. */
  saveState: Record<number, SaveState>
  /** A test case just created, whose title should take focus once. */
  fresh: number | null
  /** A new test case is on its way to Azure DevOps; another click waits for it. */
  creating: boolean

  load(opts?: { silent?: boolean }): Promise<void>
  setMode(m: TcMode): void
  setFilter(f: TcFilter): void
  setSearch(s: string): void
  select(id: number | null): void
  toggle(id: number): void
  setCollapsedAll(ids: number[]): void
  /** Replace an item edited elsewhere so the outline shows it at once. */
  merge(item: WorkItem): void
  /** Create a test case for an SRS (or none); returns its id. */
  create(srsId: number | null): Promise<number | null>
  /** Save fields of one test case. Saves to one test case go one at a time, each against the latest revision. */
  save(id: number, fields: Record<string, unknown>): Promise<void>
  /** Send again what a failed save could not. */
  retrySave(id: number): Promise<void>
  linkSrs(id: number, srsId: number): Promise<void>
  unlinkSrs(id: number, srsId: number): Promise<void>
  clearFresh(): void
  /** Record a run as a comment (with screenshots) and update Last Outcome / Last Tested Release. */
  recordRun(id: number, r: Omit<RunRecord, 'images'>, files: File[]): Promise<{ mirrored: boolean; note?: string }>
  /** The latest run of each test case in a release, read from their comments. */
  runsFor(ids: number[], release: string): Promise<Map<number, RunRecord>>
  /** File a bug for a failed run, linked to the test case and under its first SRS. */
  createBug(testId: number, info: { title: string; repro: string; srsId: number | null }): Promise<number | null>
  /** Make a Shared Steps item from these steps; returns its id. */
  createShared(title: string, items: StepItem[]): Promise<number | null>
  /** Test cases whose SRS text or criteria changed after they were last reviewed against it. */
  reviewNeeded: Map<number, { srsId: number; change: SpecChange }[]>
  checkReviews(): Promise<void>
  markReviewed(testId: number, srsId: number): Promise<void>
  /** Releases recently tested, newest first. */
  releases: string[]
  /** Create or update test cases from a spreadsheet; reports each one as it finishes. */
  importCases(plan: PlannedCase[], onDone: (i: number, result: { id?: number; error?: string }) => void): Promise<void>
}

const collapsedKey = (org: string, project: string) => `tc.collapsed.${org}/${project}`

export const useTcStore = create<TcState>((set, get) => ({
  project: null,
  cfg: null,
  tests: [],
  shared: [],
  loading: false,
  error: null,
  loadedAt: null,
  mode: ((): TcMode => { try { const m = localStorage.getItem('tc.mode') as TcMode; return MODES.includes(m) ? m : 'outline' } catch { return 'outline' } })(),
  filter: 'all',
  search: '',
  selectedId: null,
  collapsed: new Set(),
  saveState: {},
  fresh: null,
  creating: false,
  reviewNeeded: new Map(),
  releases: ((): string[] => { try { return JSON.parse(localStorage.getItem('tc.releases') ?? '[]') as string[] } catch { return [] } })(),

  load: async (opts) => {
    const org = useAppStore.getState().activeOrg
    const project = useAppStore.getState().selectedProject?.name ?? null
    const cfg = tcConfig(useBoardStore.getState().ctx)
    if (!org || !project) return
    if (project !== get().project) {
      set({ project, tests: [], shared: [], selectedId: null, error: null, loadedAt: null, collapsed: readSet(collapsedKey(org, project)) })
    }
    set({ cfg })
    if (!cfg) { set({ loading: false, loadedAt: Date.now() }); return }
    if (!opts?.silent) set({ loading: true, error: null })
    try {
      const [tests, shared] = await Promise.all([
        // SRS links come with the relations; removed test cases verify nothing and stay out.
        api().projectItems(org, project, [cfg.type.name], ['Removed'], cfg.extraFields, true),
        cfg.sharedStepsType ? api().projectItems(org, project, [cfg.sharedStepsType.name], [], [STEPS]).catch(() => [] as WorkItem[]) : Promise.resolve([] as WorkItem[]),
      ])
      if (get().project !== project) return
      // A test case with a save waiting or on its way keeps what is on screen; the save brings it up to date.
      const busy = (id: number) => unsaved.has(id) || get().saveState[id] === 'saving'
      const mine = new Map(get().tests.map((t) => [t.id, t]))
      if (!opts?.silent) runCache.clear()
      set({ tests: tests.map((t) => (busy(t.id) && mine.has(t.id) ? mine.get(t.id)! : t)), shared, loading: false, error: null, loadedAt: Date.now() })
    } catch (e) {
      if (get().project === project) set({ loading: false, error: errorText(e) })
    }
  },

  setMode: (mode) => { try { localStorage.setItem('tc.mode', mode) } catch { /* ignore */ } set({ mode }) },
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  select: (selectedId) => set({ selectedId }),
  toggle: (id) => {
    const next = new Set(get().collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    get().setCollapsedAll([...next])
  },
  setCollapsedAll: (ids) => {
    const next = new Set(ids)
    set({ collapsed: next })
    const org = useAppStore.getState().activeOrg
    const project = get().project
    if (org && project) writeSet(collapsedKey(org, project), next)
  },

  merge: (item) => set((s) => {
    const fresh = (list: WorkItem[]) => {
      const i = list.findIndex((x) => x.id === item.id)
      if (i < 0 || (list[i].rev ?? 0) > (item.rev ?? 0)) return null
      const next = list.slice()
      next[i] = { ...item, fields: { ...list[i].fields, ...item.fields }, relations: item.relations ?? list[i].relations }
      return next
    }
    for (const key of ['tests', 'shared'] as const) {
      const next = fresh(s[key])
      if (next) return { [key]: next }
    }
    return {}
  }),

  create: async (srsId) => {
    const { org, project, cfg } = scope(get)
    if (!org || !project || !cfg || get().creating) return null
    set({ creating: true })
    try {
      // The next SDV ID comes from what Azure DevOps holds now, not the possibly stale list here.
      const sdvRef = cfg.sdvField?.referenceName
      const sdv = sdvRef ? nextSdvId((await api().projectItems(org, project, [cfg.type.name], [], [sdvRef])).map((t) => plainText(t.fields[sdvRef]))) : null
      const created = await api().createWorkItem(org, project, cfg.type.name, { 'System.Title': 'New test case', ...(sdvRef && sdv ? { [sdvRef]: sdv } : {}) }, null)
      let item = srsId ? await api().addLink(org, project, created.id, srsId, TESTS_LINK) : created
      // Someone may have created a test case with the same number in the meantime; the later one moves on.
      if (sdvRef) {
        const all = (await api().projectItems(org, project, [cfg.type.name], [], [sdvRef])).map((t) => ({ id: t.id, sdv: plainText(t.fields[sdvRef]) }))
        const moved = sdvAfterCreate(all, item.id)
        if (moved) {
          item = await api().updateWorkItem(org, project, item.id, item.rev ?? null, { [sdvRef]: moved })
          useUiStore.getState().toast({ kind: 'success', title: `${sdv} was just taken`, detail: `This test case is ${moved}.` })
        }
      }
      if (get().project !== project) return item.id
      set((s) => ({ tests: [item, ...s.tests.filter((t) => t.id !== item.id)], selectedId: item.id, fresh: item.id }))
      return item.id
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create the test case', detail: errorText(e) })
      return null
    } finally {
      set({ creating: false })
    }
  },

  save: (id, fields) => {
    const before = get().tests.find((t) => t.id === id)
    if (!before) return Promise.resolve()
    // Show the edit at once; it waits its turn behind any save already on its way.
    unsaved.set(id, { ...(unsaved.get(id) ?? {}), ...fields })
    set((s) => ({ tests: replace(s.tests, { ...before, fields: { ...before.fields, ...fields } }), saveState: { ...s.saveState, [id]: 'saving' } }))
    return inTurn(id, () => flush(get, set, id))
  },

  retrySave: (id) => {
    if (!unsaved.has(id)) return Promise.resolve()
    set((s) => ({ saveState: { ...s.saveState, [id]: 'saving' }, error: null }))
    return inTurn(id, () => flush(get, set, id))
  },

  linkSrs: (id, srsId) => inTurn(id, async () => {
    const { org, project } = scope(get)
    if (!org || !project) return
    try {
      adopt(get, set, await api().addLink(org, project, id, srsId, TESTS_LINK))
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not link the requirement', detail: errorText(e) })
    }
  }),

  unlinkSrs: (id, srsId) => inTurn(id, async () => {
    const { org, project } = scope(get)
    if (!org || !project) return
    try {
      adopt(get, set, await api().removeLink(org, project, id, srsId, TESTS_LINK))
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not unlink the requirement', detail: errorText(e) })
    }
  }),

  clearFresh: () => set({ fresh: null }),

  recordRun: async (id, r, files) => {
    const { org, project, cfg } = scope(get)
    const test = get().tests.find((t) => t.id === id)
    if (!org || !project || !cfg || !test) throw new Error('This test case is not loaded.')
    const images: RunRecord['images'] = []
    const uploads: { name: string; dataBase64: string }[] = []
    for (const f of files) {
      const name = f.name || `screenshot-${Date.now()}.png`
      const data = await readBase64(f)
      const { url } = await api().uploadAttachment(org, project, name, data)
      images.push({ url, caption: name })
      uploads.push({ name, dataBase64: data })
    }
    const record: RunRecord = { ...r, images }
    await inTurn(id, () => api().addComment(org, project, id, runToComment(record)))
    runCache.set(id, [...(runCache.get(id) ?? []), record])
    // The comment is a new revision of the test case.
    await refresh(get, set, id)
    const fields: Record<string, unknown> = {
      ...(cfg.lastOutcomeField ? { [cfg.lastOutcomeField.referenceName]: r.outcome === 'pass' ? 'Passed' : 'Failed' } : {}),
      ...(cfg.lastReleaseField ? { [cfg.lastReleaseField.referenceName]: r.release } : {}),
    }
    if (Object.keys(fields).length) await get().save(id, fields)
    const releases = [r.release, ...get().releases.filter((x) => x !== r.release)].slice(0, 8)
    try { localStorage.setItem('tc.releases', JSON.stringify(releases)) } catch { /* ignore */ }
    set({ releases })
    // Test Plans is an extra copy: whatever happens there, the run above is already saved.
    const mirror = await api()
      .tpMirrorResult(org, project, { release: r.release, testCaseId: id, outcome: r.outcome === 'pass' ? 'Passed' : 'Failed', comment: r.note, attachments: uploads })
      .catch((e) => ({ mirrored: false, reason: errorText(e) }))
    return mirror.mirrored ? { mirrored: true } : { mirrored: false, note: `Not mirrored to Test Plans: ${mirror.reason ?? 'unknown reason'}` }
  },

  runsFor: async (ids, release) => {
    const { org, project } = scope(get)
    const out = new Map<number, RunRecord>()
    if (!org || !project) return out
    const missing = ids.filter((id) => !runCache.has(id))
    // A few at a time: one request per test case.
    let failed = 0
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map(async (id) => {
        try {
          const comments = await api().getComments(org, project, id)
          runCache.set(id, comments.map((c) => commentToRun(c.text)).filter((x): x is RunRecord => !!x))
        } catch {
          // Not cached, so the next look asks again; "not run" would be wrong here.
          failed++
        }
      }))
    }
    if (failed) useUiStore.getState().toast({ kind: 'error', title: `Could not load run results for ${failed} test case${failed === 1 ? '' : 's'}`, detail: 'They show as not run until you refresh.' })
    for (const id of ids) {
      const hit = (runCache.get(id) ?? []).filter((r) => r.release === release).pop()
      if (hit) out.set(id, hit)
    }
    return out
  },

  createBug: async (testId, info) => {
    const { org, project } = scope(get)
    if (!org || !project) return null
    try {
      const bug = await api().createWorkItem(org, project, 'Bug', { 'System.Title': info.title, 'Microsoft.VSTS.TCM.ReproSteps': info.repro }, info.srsId)
      await api().addLink(org, project, bug.id, testId, 'System.LinkTypes.Related')
      // Linking changed the test case too.
      if (get().tests.some((t) => t.id === testId)) await refresh(get, set, testId)
      useUiStore.getState().toast({ kind: 'success', title: `Bug #${bug.id} created` })
      return bug.id
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create the bug', detail: errorText(e) })
      return null
    }
  },

  checkReviews: async () => {
    const { org, project } = scope(get)
    const req = useReqStore.getState()
    if (!org || !project || !req.cfg || req.project !== project) return
    const srsTier = req.cfg.tiers[2]
    const fields = [srsTier.textField?.referenceName, req.cfg.acceptanceField?.referenceName].filter((x): x is string => !!x)
    const srsById = new Map(req.items.filter((i) => i.fields['System.WorkItemType'] === srsTier.type.name).map((i) => [i.id, i]))
    const out = new Map<number, { srsId: number; change: SpecChange }[]>()
    for (const t of get().tests) {
      const marks = reviewMarks(t)
      for (const srsId of linkedIds(t, [TESTS_LINK])) {
        const srs = srsById.get(srsId)
        if (!srs) continue
        const mark = marks.find((m) => m.srsId === srsId)
        // Cheap checks first: reviewed at the current revision, or untouched since the test case was written.
        if (mark && mark.rev >= (srs.rev ?? 0)) continue
        if (!mark && new Date(String(srs.fields['System.ChangedDate'] ?? 0)) <= new Date(String(t.fields['System.CreatedDate'] ?? 0))) continue
        const key = `${srsId}@${srs.rev}`
        if (!historyCache.has(key)) historyCache.set(key, api().getUpdates(org, project, srsId).catch(() => []))
        const updates = await historyCache.get(key)!
        const since = mark?.rev ?? baselineRev(updates, String(t.fields['System.CreatedDate'] ?? ''))
        const change = specChangedSince(updates, fields, since)
        if (change) out.set(t.id, [...(out.get(t.id) ?? []), { srsId, change }])
      }
    }
    if (get().project === project) set({ reviewNeeded: out })
  },

  markReviewed: async (testId, srsId) => {
    const t = get().tests.find((x) => x.id === testId)
    const srs = useReqStore.getState().items.find((i) => i.id === srsId)
    if (!t || !srs) return
    await get().save(testId, { 'System.Tags': withReviewMark(String(t.fields['System.Tags'] ?? ''), { srsId, rev: srs.rev ?? 0 }) })
    set((s) => {
      const next = new Map(s.reviewNeeded)
      const left = (next.get(testId) ?? []).filter((r) => r.srsId !== srsId)
      if (left.length) next.set(testId, left)
      else next.delete(testId)
      return { reviewNeeded: next }
    })
  },

  createShared: async (title, items) => {
    const { org, project, cfg } = scope(get)
    if (!org || !project || !cfg?.sharedStepsType) return null
    try {
      const created = await api().createWorkItem(org, project, cfg.sharedStepsType.name, { 'System.Title': title, [STEPS]: serializeSteps(items) }, null)
      set((s) => ({ shared: [...s.shared, created] }))
      return created.id
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create the shared steps', detail: errorText(e) })
      return null
    }
  },

  importCases: async (plan, onDone) => {
    const { org, project, cfg } = scope(get)
    if (!org || !project || !cfg) return
    const sharedByTitle = new Map(get().shared.map((w) => [String(w.fields['System.Title'] ?? ''), w.id]))
    const titleOfShared = new Map(get().shared.map((w) => [w.id, String(w.fields['System.Title'] ?? '')]))
    for (const [i, c] of plan.entries()) {
      try {
        // Over an existing test case, steps are matched to the ones there, so ids, shared steps and formatting stay.
        const existing = c.existingId ? await api().getWorkItem(org, project, c.existingId) : null
        const prevXml = existing ? String(existing.fields[STEPS] ?? '') : ''
        const prev = parseSteps(prevXml).map((it): StepItem => (it.kind === 'shared' ? { ...it, title: titleOfShared.get(it.ref) } : it))
        const steps = existing ? textToSteps(c.stepsText, prev, sharedByTitle) : c.steps
        const fields: Record<string, unknown> = {
          ...(c.existingId && !c.titleGiven ? {} : { 'System.Title': c.title }),
          ...(cfg.sdvField ? { [cfg.sdvField.referenceName]: c.sdv } : {}),
          ...(steps.length ? { [STEPS]: serializeSteps(steps, prevXml || undefined) } : {}),
          ...(c.preconditions ? { [cfg.preconditionsField.referenceName]: htmlFromPlain(c.preconditions) } : {}),
        }
        const item = existing
          ? await api().updateWorkItem(org, project, existing.id, existing.rev ?? null, fields)
          : await api().createWorkItem(org, project, cfg.type.name, fields, null)
        for (const srsId of c.srsIds) await api().addLink(org, project, item.id, srsId, TESTS_LINK)
        onDone(i, { id: item.id })
      } catch (e) {
        onDone(i, { error: errorText(e) })
      }
    }
    await get().load({ silent: true })
  },
}))

type Set_ = (partial: Partial<TcState> | ((s: TcState) => Partial<TcState>)) => void

/** Fields typed but not yet saved, per test case. */
const unsaved = new Map<number, Record<string, unknown>>()
/** Per test case, the end of its line of pending requests. */
const turns = new Map<number, Promise<unknown>>()

/** Run `op` after everything already queued for this test case. */
function inTurn<T>(id: number, op: () => Promise<T>): Promise<T> {
  const run = (turns.get(id) ?? Promise.resolve()).then(op, op)
  turns.set(id, run.catch(() => undefined))
  return run
}

/** Take a fresh copy from Azure DevOps, with anything still waiting to be saved shown on top. */
function adopt(get: () => TcState, set: Set_, item: WorkItem) {
  const before = get().tests.find((t) => t.id === item.id)
  const waiting = unsaved.get(item.id) ?? {}
  set((s) => ({ tests: replace(s.tests, { ...item, fields: { ...item.fields, ...waiting }, relations: item.relations ?? before?.relations }) }))
}

/** Send whatever is waiting for one test case, against its current revision. */
async function flush(get: () => TcState, set: Set_, id: number) {
  const { org, project } = scope(get)
  const fields = unsaved.get(id)
  const cur = get().tests.find((t) => t.id === id)
  if (!org || !project || !fields || !cur) return
  unsaved.delete(id)
  try {
    const updated = await api().updateWorkItem(org, project, id, cur.rev ?? null, fields)
    adopt(get, set, updated)
    if (!unsaved.has(id)) set((s) => ({ saveState: { ...s.saveState, [id]: 'saved' } }))
  } catch (e) {
    if (isAppError(e) && e.kind === 'conflict') {
      // Only a change by someone else gets here: our own saves are sent one after another.
      const latest = await api().getWorkItem(org, project, id).catch(() => cur)
      unsaved.delete(id)
      set((s) => ({ tests: replace(s.tests, latest), saveState: { ...s.saveState, [id]: 'failed' }, error: 'Someone else changed this test case. The latest version is shown.' }))
    } else {
      // Keep what was typed on screen and in the queue, so it can be sent again.
      unsaved.set(id, { ...fields, ...(unsaved.get(id) ?? {}) })
      set((s) => ({ saveState: { ...s.saveState, [id]: 'failed' }, error: `Could not save: ${errorText(e)}. Your changes are still here.` }))
    }
  }
}

/** Re-read a test case after something else (a comment, a link from another item) gave it a new revision. */
const refresh = (get: () => TcState, set: Set_, id: number) => inTurn(id, async () => {
  const { org, project } = scope(get)
  if (!org || !project) return
  adopt(get, set, await api().getWorkItem(org, project, id))
})

/** SRS update histories by "id@rev", for this session. */
const historyCache = new Map<string, Promise<unknown[]>>()

/** Runs read from comments, per test case, for this session. */
const runCache = new Map<number, RunRecord[]>()

const readBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
  r.onerror = () => reject(r.error ?? new Error('The file could not be read.'))
  r.readAsDataURL(f)
})

const scope = (get: () => TcState) => ({ org: useAppStore.getState().activeOrg, project: get().project, cfg: get().cfg })
const replace = (list: WorkItem[], item: WorkItem) => list.map((t) => (t.id === item.id ? item : t))

// Edits made in the details panel arrive in the board store; mirror them into the outline.
useBoardStore.subscribe((s, prev) => {
  if (s.detached && s.detached !== prev.detached) useTcStore.getState().merge(s.detached)
})

/** Load the project's test cases and shared steps once its process is known. */
export function ensureTcLoaded(projectName: string, ctx: TeamContext): void {
  const st = useTcStore.getState()
  const sig = (c: TcConfig | null) => (c ? c.type.name + c.extraFields.join() : '')
  if (st.project !== projectName || !st.loadedAt || sig(st.cfg) !== sig(tcConfig(ctx))) void st.load()
}
