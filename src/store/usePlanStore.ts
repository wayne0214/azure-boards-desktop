import { create } from 'zustand'
import { api } from '@/lib/api'
import { bucketOf, type Bucket, type Markable, type NewPlanInput, type ResultOutcome, type RunInput, type TpConfiguration, type TpPlan, type TpPoint, type TpResult, type TpRun, type TpSuite } from '@/lib/testplans/types'
import { outcomesOn, projectPlan, versionsOf } from '@/lib/testplans/versions'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

export type PlanTab = 'points' | 'report'
export type OutcomeFilter = 'all' | Bucket
/** Points as they stand now, or as they were on the selected version. */
export type PointView = 'latest' | 'version'

const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)
const isRefusal = (e: unknown) => {
  const x = e as { kind?: string; status?: number; message?: string }
  return x?.kind === 'forbidden' || x?.kind === 'unauthorized' || x?.status === 403 || /TF400813|not authorized|access level|license/i.test(x?.message ?? '')
}
/** What to tell the user when Azure DevOps refuses Test Plans. */
export const accessHint = (e: unknown, action: string) =>
  isRefusal(e) ? `Azure DevOps refused to ${action}. Creating plans and suites needs Basic + Test Plans access; running tests needs Basic, and the token needs Test Management (Read & write).` : errorText(e)

interface PlanState {
  project: string | null
  /** "org/project" the state belongs to; a response for another scope is dropped. */
  scopeKey: string | null
  plans: TpPlan[]
  plansLoading: boolean
  plansError: string | null
  showInactive: boolean
  configurations: TpConfiguration[]

  planId: number | null
  suites: TpSuite[]
  suitesLoading: boolean
  suiteId: number | null
  /** Points per suite id, as last read. */
  points: Record<number, TpPoint[]>
  /** Suites whose points are on their way. */
  pointsLoading: Record<number, boolean>
  pointsError: string | null

  tab: PlanTab
  outcome: OutcomeFilter
  configurationId: number | null
  mine: boolean
  search: string
  selected: Set<number>
  /** The point open in the runner. */
  runningId: number | null

  /** The open plan's runs, newest first. */
  runs: TpRun[]
  /** Versions typed in by the user for the open plan, not yet on any run. */
  addedVersions: string[]
  /** The version being tested: every run, import and mark from the plan is tagged with it. */
  version: string | null
  view: PointView
  /** The selected version's latest result per point, while `view` is "version". */
  versionResults: Map<number, TpResult> | null
  versionLoading: boolean

  loadPlans(opts?: { silent?: boolean }): Promise<void>
  setShowInactive(v: boolean): void
  openPlan(id: number | null): Promise<void>
  selectSuite(id: number): void
  /** Points of a suite in the open plan, or in `planId` when given. */
  loadPoints(suiteId: number, opts?: { force?: boolean; planId?: number }): Promise<TpPoint[]>
  /** Every suite's points, for the report and for matching automated results. */
  loadAllPoints(opts?: { force?: boolean }): Promise<TpPoint[]>
  setTab(t: PlanTab): void
  setOutcome(o: OutcomeFilter): void
  setConfigurationId(id: number | null): void
  setMine(v: boolean): void
  setSearch(s: string): void
  toggleSelected(id: number, on?: boolean): void
  setSelected(ids: number[]): void
  setRunning(id: number | null): void

  createPlan(input: NewPlanInput): Promise<TpPlan | null>
  createSuite(parentId: number, name: string, kind?: { requirementId?: number; tag?: string }): Promise<TpSuite | null>
  /** Close the plan at the end of a project (Inactive), or reopen it. */
  setPlanState(state: 'Active' | 'Inactive'): Promise<boolean>
  addCases(suiteId: number, ids: number[], configurationIds?: number[]): Promise<boolean>
  removeCases(suiteId: number, ids: number[]): Promise<void>
  /** Mark an outcome and/or assign a tester on points, grouped by their suite. */
  updatePoints(ids: number[], change: { outcome?: Markable; testerId?: string }): Promise<boolean>
  publishRun(input: RunInput): Promise<{ runId: number; published: number } | null>
  /** The points just changed elsewhere (a run recorded in the runner): read their suites again. */
  refreshSuites(suiteIds: number[]): Promise<void>

  loadRuns(): Promise<void>
  setVersion(v: string | null): void
  addVersion(v: string): void
  setView(v: PointView): void
  loadVersionResults(): Promise<void>
  /** Set an outcome: with a version, as a run tagged with it; without one, on the points directly. */
  mark(ids: number[], outcome: Exclude<Markable, 'reset'>): Promise<boolean>
  /** Begin testing a version: points in these suites (and the suites under them) become not run. */
  startRun(version: string, suiteIds: number[]): Promise<number>
  /** After a run recorded somewhere else (the runner): read the points, runs and version results again. */
  afterRun(suiteIds: number[]): Promise<void>
}

const NO_RESULTS = new Map<number, TpResult>()
/** The selected version's results to show points with, or null to show them as they stand now. */
export const useVersionOverlay = (): Map<number, TpResult> | null =>
  usePlanStore((s) => (s.view === 'version' && s.version ? s.versionResults ?? NO_RESULTS : null))

/** The suites a version was started on in this plan (empty: the whole plan, or never started here). */
export function versionScope(s: Pick<PlanState, 'scopeKey' | 'planId'>, version: string): number[] {
  if (!s.scopeKey || s.planId == null) return []
  try { return JSON.parse(readPref(`tp.scope.${s.scopeKey}/${s.planId}/${version.trim()}`) ?? '[]') as number[] } catch { return [] }
}

/** All versions of the open plan, newest first. */
export const planVersions = (s: Pick<PlanState, 'runs' | 'addedVersions'>): string[] => versionsOf(s.runs, s.addedVersions)
/** The plan Run mode in Test Cases records into. */
export const theProjectPlan = (s: Pick<PlanState, 'plans' | 'scopeKey'>): TpPlan | null =>
  projectPlan(s.plans, s.scopeKey ? Number(readPref(`tp.plan.${s.scopeKey}`)) || null : null)

const scope = (get: () => PlanState) => ({ org: useAppStore.getState().activeOrg, project: get().project })
/** Bumped by each plan list request, so only the latest one lands. */
let plansSeq = 0

export const usePlanStore = create<PlanState>((set, get) => ({
  project: null,
  scopeKey: null,
  plans: [],
  plansLoading: false,
  plansError: null,
  showInactive: false,
  configurations: [],
  planId: null,
  suites: [],
  suitesLoading: false,
  suiteId: null,
  points: {},
  pointsLoading: {},
  pointsError: null,
  tab: 'points',
  outcome: 'all',
  configurationId: null,
  mine: false,
  search: '',
  selected: new Set(),
  runningId: null,
  runs: [],
  addedVersions: [],
  version: null,
  view: 'latest',
  versionResults: null,
  versionLoading: false,

  loadPlans: async (opts) => {
    const org = useAppStore.getState().activeOrg
    const project = useAppStore.getState().selectedProject?.name ?? null
    if (!org || !project) return
    const key = `${org}/${project}`
    if (key !== get().scopeKey) {
      set({ project, scopeKey: key, plans: [], planId: null, suites: [], suiteId: null, points: {}, selected: new Set(), runningId: null, configurations: [], plansError: null })
    }
    const seq = ++plansSeq
    if (!opts?.silent) set({ plansLoading: true, plansError: null })
    try {
      const [plans, configurations] = await Promise.all([
        api().tpPlans(org, project, !get().showInactive),
        api().tpConfigurations(org, project).catch(() => [] as TpConfiguration[]),
      ])
      if (seq !== plansSeq || get().scopeKey !== key) return
      plans.sort((a, b) => (b.updatedDate ?? '').localeCompare(a.updatedDate ?? '') || b.id - a.id)
      set({ plans, configurations, plansLoading: false })
      // Keep the open plan while it is still listed; else the one last used in this project, else the newest.
      const cur = get().planId
      const remembered = Number(readPref(`tp.plan.${key}`))
      const id = cur != null && plans.some((p) => p.id === cur) ? cur : plans.some((p) => p.id === remembered) ? remembered : plans[0]?.id ?? null
      if (id !== cur || !get().suites.length) await get().openPlan(id)
      else await reopen(get, set, id)
    } catch (e) {
      if (seq === plansSeq && get().scopeKey === key) set({ plansLoading: false, plansError: accessHint(e, 'list the test plans') })
    }
  },

  setShowInactive: (showInactive) => { set({ showInactive }); void get().loadPlans() },

  openPlan: async (id) => {
    const { org, project } = scope(get)
    const vkey = `${org}/${project}/${id}`
    set({
      planId: id, suites: [], suiteId: null, points: {}, pointsLoading: {}, pointsError: null, selected: new Set(), runningId: null,
      runs: [], versionResults: null, view: 'latest',
      version: readPref(`tp.version.${vkey}`) || null,
      addedVersions: (() => { try { return JSON.parse(readPref(`tp.versions.${vkey}`) ?? '[]') as string[] } catch { return [] } })(),
    })
    if (!org || !project || id == null) return
    writePref(`tp.plan.${org}/${project}`, String(id))
    void get().loadRuns()
    set({ suitesLoading: true })
    try {
      const suites = await api().tpSuites(org, project, id)
      if (get().planId !== id) return
      const plan = get().plans.find((p) => p.id === id)
      set({ suites, suitesLoading: false, suiteId: plan?.rootSuiteId ?? suites.find((s) => s.parentId == null)?.id ?? suites[0]?.id ?? null })
      const sid = get().suiteId
      if (sid != null) void get().loadPoints(sid)
    } catch (e) {
      if (get().planId === id) set({ suitesLoading: false, pointsError: accessHint(e, 'open this plan') })
    }
  },

  selectSuite: (suiteId) => {
    set({ suiteId, selected: new Set(), runningId: null, tab: 'points' })
    void get().loadPoints(suiteId)
  },

  loadPoints: async (suiteId, opts) => {
    const { org, project } = scope(get)
    const planId = opts?.planId ?? get().planId
    if (!org || !project || planId == null || planId !== get().planId) return []
    const have = get().points[suiteId]
    if (have && !opts?.force) return have
    set((s) => ({ pointsLoading: { ...s.pointsLoading, [suiteId]: true }, pointsError: null }))
    try {
      const pts = await api().tpPoints(org, project, planId, suiteId)
      if (get().planId === planId) set((s) => ({ points: { ...s.points, [suiteId]: pts }, pointsLoading: { ...s.pointsLoading, [suiteId]: false } }))
      return pts
    } catch (e) {
      if (get().planId === planId) set((s) => ({ pointsLoading: { ...s.pointsLoading, [suiteId]: false }, pointsError: accessHint(e, 'read the test points') }))
      return []
    }
  },

  loadAllPoints: async (opts) => {
    const planId = get().planId
    const ids = get().suites.map((s) => s.id)
    // A few suites at a time: one request each. Stop once another plan is open.
    for (let i = 0; i < ids.length && get().planId === planId; i += 6) await Promise.all(ids.slice(i, i + 6).map((id) => get().loadPoints(id, { ...opts, planId: planId ?? undefined })))
    return ids.flatMap((id) => get().points[id] ?? [])
  },

  setTab: (tab) => set({ tab, runningId: null }),
  setOutcome: (outcome) => set({ outcome, selected: new Set() }),
  setConfigurationId: (configurationId) => set({ configurationId, selected: new Set() }),
  setMine: (mine) => set({ mine, selected: new Set() }),
  setSearch: (search) => set({ search }),
  toggleSelected: (id, on) => set((s) => {
    const next = new Set(s.selected)
    if (on ?? !next.has(id)) next.add(id)
    else next.delete(id)
    return { selected: next }
  }),
  setSelected: (ids) => set({ selected: new Set(ids) }),
  setRunning: (runningId) => set({ runningId }),

  createPlan: async (input) => {
    const { org, project } = scope(get)
    if (!org || !project) return null
    try {
      const { warning, ...plan } = await api().tpCreatePlan(org, project, input)
      set((s) => ({ plans: [plan, ...s.plans.filter((p) => p.id !== plan.id)] }))
      if (warning) useUiStore.getState().toast({ kind: 'error', title: 'Plan created with a problem', detail: warning })
      await get().openPlan(plan.id)
      return plan
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create the plan', detail: accessHint(e, 'create the plan') })
      // It may exist all the same; showing it keeps a second click from making another.
      void get().loadPlans({ silent: true })
      return null
    }
  },

  createSuite: async (parentId, name, kind) => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null) return null
    try {
      const suite = await api().tpCreateSuite(org, project, planId, { parentId, name, ...kind })
      if (get().planId === planId) set((s) => ({ suites: [...s.suites, suite] }))
      // Requirement and tag suites fill themselves.
      if (kind) void get().loadPoints(suite.id, { force: true })
      return suite
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: `Could not create the suite "${name}"`, detail: accessHint(e, 'create the suite') })
      return null
    }
  },

  addCases: async (suiteId, ids, configurationIds) => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null || !ids.length) return false
    try {
      await api().tpAddCases(org, project, planId, suiteId, ids, configurationIds)
      await get().loadPoints(suiteId, { force: true })
      return true
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not add the test cases', detail: accessHint(e, 'add test cases to the suite') })
      return false
    }
  },

  removeCases: async (suiteId, ids) => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null || !ids.length) return
    try {
      await api().tpRemoveCases(org, project, planId, suiteId, ids)
      set({ selected: new Set() })
      await get().loadPoints(suiteId, { force: true })
      useUiStore.getState().toast({ kind: 'success', title: `Took ${ids.length} test case${ids.length === 1 ? '' : 's'} out of the suite`, detail: 'The test cases themselves are unchanged.' })
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not remove the test cases', detail: accessHint(e, 'change the suite') })
    }
  },

  updatePoints: async (ids, change) => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null || !ids.length) return false
    const want = new Set(ids)
    const bySuite = new Map<number, number[]>()
    for (const [sid, pts] of Object.entries(get().points)) {
      for (const p of pts) if (want.has(p.id)) bySuite.set(Number(sid), [...(bySuite.get(Number(sid)) ?? []), p.id])
    }
    // Show the change at once; the answer from Azure DevOps replaces it.
    const people = new Map(Object.values(get().points).flat().flatMap((p) => (p.tester ? [[p.tester.id, p.tester] as const] : [])))
    const me = useAppStore.getState().account()
    if (me) people.set(me.userId, { id: me.userId, displayName: me.userName })
    set((s) => ({
      points: Object.fromEntries(Object.entries(s.points).map(([sid, pts]) => [sid, pts.map((p) => (want.has(p.id) ? {
        ...p,
        ...(change.outcome ? { outcome: change.outcome === 'reset' ? 'unspecified' : change.outcome } : {}),
        ...(change.testerId ? { tester: people.get(change.testerId) ?? p.tester } : {}),
      } : p))])),
    }))
    const left = [...bySuite.keys()]
    try {
      for (const [sid, pids] of bySuite) {
        const updated = await api().tpUpdatePoints(org, project, planId, sid, pids.map((id) => ({ id, ...change })))
        left.shift()
        const fresh = new Map(updated.map((p) => [p.id, p]))
        if (get().planId === planId) set((s) => ({ points: { ...s.points, [sid]: (s.points[sid] ?? []).map((p) => fresh.get(p.id) ?? p) } }))
      }
      return true
    } catch (e) {
      // Suites already updated keep their answer; the rest are read again rather than guessed.
      await Promise.all(left.map((sid) => get().loadPoints(sid, { force: true, planId })))
      useUiStore.getState().toast({ kind: 'error', title: 'Could not update the test points', detail: accessHint(e, 'update the test points') })
      return false
    }
  },

  publishRun: async (input) => {
    const { org, project } = scope(get)
    if (!org || !project) return null
    try {
      const out = await api().tpPublishRun(org, project, { ...input, buildNumber: input.buildNumber ?? get().version ?? undefined })
      const pointIds = new Set(input.results.map((r) => r.pointId))
      const suites = Object.entries(get().points).filter(([, pts]) => pts.some((p) => pointIds.has(p.id))).map(([sid]) => Number(sid))
      await get().afterRun(suites)
      return out
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not publish the run', detail: accessHint(e, 'publish the test run') })
      return null
    }
  },

  refreshSuites: async (suiteIds) => {
    const planId = get().planId ?? undefined
    await Promise.all([...new Set(suiteIds)].map((id) => get().loadPoints(id, { force: true, planId })))
  },

  setPlanState: async (state) => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null) return false
    try {
      const plan = await api().tpSetPlanState(org, project, planId, state)
      set((s) => ({ plans: s.plans.map((p) => (p.id === plan.id ? { ...p, ...plan } : p)) }))
      return true
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: state === 'Inactive' ? 'Could not close the plan' : 'Could not reopen the plan', detail: accessHint(e, 'change the plan') })
      return false
    }
  },

  loadRuns: async () => {
    const { org, project } = scope(get)
    const planId = get().planId
    if (!org || !project || planId == null) return
    try {
      const runs = await api().tpRuns(org, project, planId)
      if (get().planId !== planId) return
      set({ runs })
      if (get().view === 'version') await get().loadVersionResults()
    } catch {
      // The version list then holds only versions added here; points still work.
    }
  },

  setVersion: (version) => {
    const { org, project } = scope(get)
    const v = version?.trim() || null
    set({ version: v, versionResults: null, view: v ? get().view : 'latest' })
    if (org && project && get().planId != null) writePref(`tp.version.${org}/${project}/${get().planId}`, v ?? '')
    if (v && get().view === 'version') void get().loadVersionResults()
  },

  addVersion: (version) => {
    const v = version.trim()
    if (!v) return
    const { org, project } = scope(get)
    if (!planVersions(get()).includes(v)) {
      const added = [...get().addedVersions, v]
      set({ addedVersions: added })
      if (org && project && get().planId != null) writePref(`tp.versions.${org}/${project}/${get().planId}`, JSON.stringify(added))
    }
    get().setVersion(v)
  },

  setView: (view) => {
    set({ view: get().version ? view : 'latest', selected: new Set() })
    if (get().view === 'version') void get().loadVersionResults()
  },

  loadVersionResults: async () => {
    const { org, project } = scope(get)
    const { planId, version } = get()
    if (!org || !project || planId == null || !version) return
    const runIds = get().runs.filter((r) => r.buildNumber?.trim() === version).map((r) => r.id)
    set({ versionLoading: true })
    try {
      const results = runIds.length ? await api().tpRunResults(org, project, runIds) : []
      if (get().planId === planId && get().version === version) set({ versionResults: outcomesOn(version, get().runs, results), versionLoading: false })
    } catch (e) {
      if (get().planId === planId) set({ versionLoading: false, pointsError: accessHint(e, 'read the runs of this version') })
    }
  },

  mark: async (ids, outcome) => {
    const { planId, version } = get()
    if (planId == null || !ids.length) return false
    // Marking a point directly makes a run with no version, so with a version the outcome is published as a run.
    if (!version) return get().updatePoints(ids, { outcome })
    const me = useAppStore.getState().account()
    const out = await get().publishRun({
      planId, name: `Marked ${version}${me ? ` · ${me.userName}` : ''}`, automated: false, buildNumber: version,
      results: ids.map((pointId) => ({ pointId, outcome: RESULT_OF[outcome] })),
    })
    return !!out
  },

  startRun: async (version, suiteIds) => {
    const pts = new Set<number>()
    for (const sid of suiteIds) for (const p of get().points[sid] ?? []) pts.add(p.id)
    get().addVersion(version)
    // What the version was started on, so its report knows which points were meant to be run.
    const { org, project } = scope(get)
    if (org && project && get().planId != null) writePref(`tp.scope.${org}/${project}/${get().planId}/${version.trim()}`, JSON.stringify(suiteIds))
    if (!pts.size) return 0
    const ok = await get().updatePoints([...pts], { outcome: 'reset' })
    if (ok) set({ view: 'version' })
    if (ok) void get().loadVersionResults()
    return ok ? pts.size : 0
  },

  afterRun: async (suiteIds) => {
    await Promise.all([get().refreshSuites(suiteIds), get().loadRuns()])
  },
}))

const RESULT_OF: Record<Exclude<Markable, 'reset'>, ResultOutcome> = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', notApplicable: 'NotApplicable' }

/** Read the open plan's suites and points again (reload, refresh on focus), keeping the selection. */
async function reopen(get: () => PlanState, set: (p: Partial<PlanState>) => void, planId: number) {
  const { org, project } = scope(get)
  if (!org || !project) return
  try {
    const suites = await api().tpSuites(org, project, planId)
    if (get().planId !== planId) return
    const suiteId = suites.some((x) => x.id === get().suiteId) ? get().suiteId : suites.find((x) => x.parentId == null)?.id ?? null
    set({ suites, suiteId })
    await Promise.all([get().loadAllPoints({ force: true }), get().loadRuns()])
  } catch (e) {
    if (get().planId === planId) set({ pointsError: accessHint(e, 'open this plan') })
  }
}

function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

/** The points a filter leaves, in test case order. */
export function visiblePoints(points: TpPoint[], f: { outcome: OutcomeFilter; configurationId: number | null; mine: boolean; search: string; userId?: string; labels: Map<number, string> }): TpPoint[] {
  const q = f.search.trim().toLowerCase()
  return points.filter((p) =>
    (f.outcome === 'all' || bucketOf(p.outcome) === f.outcome)
    && (f.configurationId == null || p.configurationId === f.configurationId)
    && (!f.mine || (!!f.userId && p.tester?.id === f.userId))
    && (!q || p.testCaseTitle.toLowerCase().includes(q) || String(p.testCaseId).includes(q) || (f.labels.get(p.testCaseId) ?? '').toLowerCase().includes(q)),
  ).sort((a, b) => (f.labels.get(a.testCaseId) ?? `#${a.testCaseId}`).localeCompare(f.labels.get(b.testCaseId) ?? `#${b.testCaseId}`, undefined, { numeric: true }) || a.configurationName.localeCompare(b.configurationName))
}
