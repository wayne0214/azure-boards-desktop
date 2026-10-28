import { Archive, ArrowLeft, Bot, Tag, Check, ClipboardList, ExternalLink, FileCheck2, FileSearch, Folder, FolderPlus, History, ListPlus, MoreHorizontal, PlayCircle, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { Empty } from '@/components/ui/Empty'
import { RunHistorySheet } from '@/components/testcases/CaseRuns'
import { RunCase } from '@/components/testcases/RunView'
import { api } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import { relativeTime } from '@/lib/format'
import { suiteAndBelow, suiteTotals, type Counts } from '@/lib/testplans/report'
import { bucketOf, planUrl, releaseOf, type Markable, type TpPlan, type TpPoint, type TpSuite } from '@/lib/testplans/types'
import type { Identity } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useVersionOverlay, usePlanStore, visiblePoints, type OutcomeFilter } from '@/store/usePlanStore'
import { withVersion } from '@/lib/testplans/versions'
import { ensureReqLoaded, useReqStore } from '@/store/useReqStore'
import { ensureTcLoaded, useTcStore } from '@/store/useTcStore'
import { OutcomeBar, OutcomePill } from './bits'
import { ImportResultsSheet } from './ImportResultsSheet'
import { usePlanLookups, type PlanLookups } from './lookups'
import { AddCasesSheet, NewPlanSheet, NewSuiteSheet, type NewSuiteKind } from './PlanSheets'
import { PlanReport } from './PlanReport'
import { LastResultPill, ResultSheet } from './ResultSheet'
import { useTagVersions } from './TagVersions'
import { CloseProjectSheet, StartRunSheet, VersionBar } from './VersionBar'

type SheetKind = null | 'plan' | 'import' | 'start' | 'close' | { suite: NewSuiteKind; parentId: number } | { add: number }

/** Azure Test Plans for the project: plans, suites, test points, runs and reports. */
export function PlansView() {
  const project = useAppStore((s) => s.selectedProject)
  const org = useAppStore((s) => s.activeOrg)
  const ctx = useBoardStore((s) => s.ctx)
  const s = usePlanStore(useShallow((st) => ({
    plans: st.plans, plansLoading: st.plansLoading, plansError: st.plansError, planId: st.planId, suites: st.suites, suitesLoading: st.suitesLoading,
    points: st.points, tab: st.tab, runningId: st.runningId, showInactive: st.showInactive,
    loadPlans: st.loadPlans, openPlan: st.openPlan, setPlanState: st.setPlanState, setTab: st.setTab, setShowInactive: st.setShowInactive, loadAllPoints: st.loadAllPoints,
  })))
  const lookups = usePlanLookups()
  const [sheet, setSheet] = useState<SheetKind>(null)
  const tags = useTagVersions()
  const moreBtn = useRef<HTMLButtonElement>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (!project || !ctx) return
    ensureReqLoaded(project.name, ctx)
    ensureTcLoaded(project.name, ctx)
    const st = usePlanStore.getState()
    if (st.scopeKey !== `${org}/${project.name}` || !st.plans.length) void st.loadPlans()
  }, [project, ctx, org])

  // Counts in the suite tree need every suite's points; read them once the plan's suites are in.
  useEffect(() => { if (s.suites.length) void s.loadAllPoints() }, [s.suites]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = s.plans.find((p) => p.id === s.planId) ?? null
  const overlay = useVersionOverlay()
  const allPoints = useMemo(() => withVersion(Object.values(s.points).flat(), overlay), [s.points, overlay])
  const totals = useMemo(() => suiteTotals(s.suites, allPoints), [s.suites, allPoints])

  if (!project) return <Empty title="Choose a project">Pick a project in the sidebar to see its test plans.</Empty>
  if (!ctx) return <div className="empty-state"><span className="spinner lg" /><p>Loading {project.name}…</p></div>

  const reload = () => { void s.loadPlans(); void useTcStore.getState().load({ silent: true }) }

  return (
    <div className="req">
      <div className="req-head">
        <div className="req-title tp-title">
          <strong>Test Plans</strong>
        </div>
        {s.plans.length > 0 && (
          <select className="input tp-plan-pick" value={s.planId ?? ''} onChange={(e) => void s.openPlan(Number(e.target.value))} aria-label="Test plan">
            {s.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.state === 'Inactive' ? ' (inactive)' : ''}</option>)}
          </select>
        )}
        {plan && (
          <div className="segmented">
            <button type="button" className={s.tab === 'points' ? 'on' : ''} onClick={() => s.setTab('points')}><ClipboardList size={14} /> Points</button>
            <button type="button" className={s.tab === 'report' ? 'on' : ''} onClick={() => s.setTab('report')}><FileCheck2 size={14} /> Report</button>
          </div>
        )}
        <span className="grow" />
        <button type="button" className="icon-btn" title="Reload" onClick={reload} disabled={s.plansLoading}><RefreshCw size={16} className={s.plansLoading ? 'spin' : ''} /></button>
        <button ref={moreBtn} type="button" className="icon-btn" title="More: import results, new plan, version tags…" aria-label="More" onClick={() => setMore(true)}><MoreHorizontal size={16} /></button>
        <Dropdown<string>
          anchor={moreBtn.current}
          open={more}
          align="right"
          width={280}
          onClose={() => setMore(false)}
          multi
          value={[...(s.showInactive ? ['inactive'] : []), ...(tags.prerelease ? ['prerelease'] : []), `repo:${tags.repoId ?? ''}`]}
          options={[
            ...(plan ? [{ value: 'import', label: 'Import results…', icon: <Upload size={14} />, group: 'Plan' }] : []),
            { value: 'new', label: 'New plan…', icon: <Plus size={14} />, group: 'Plan' },
            ...(plan && org ? [{ value: 'open', label: 'Open in Azure DevOps', icon: <ExternalLink size={14} />, group: 'Plan' }] : []),
            ...(plan && plan.state !== 'Inactive' ? [{ value: 'close', label: 'Close project…', icon: <Archive size={14} />, group: 'Plan' }] : []),
            { value: 'inactive', label: 'Show inactive plans', group: 'Show' },
            ...(tags.repos?.length ? [
              ...tags.repos.map((r) => ({ value: `repo:${r.id}`, label: r.id === tags.repoId && tags.error ? `${r.name} (no access: needs Code Read)` : r.name, group: 'Suggest versions from tags in' })),
              { value: 'repo:', label: 'No repository', group: 'Suggest versions from tags in' },
              { value: 'prerelease', label: 'Include pre-release tags', group: 'Suggest versions from tags in' },
            ] : []),
          ]}
          onSelect={(v) => {
            if (v.startsWith('repo:')) { void tags.setRepo(v.slice(5) || null); return }
            if (v === 'prerelease') { tags.setPrerelease(!tags.prerelease); return }
            if (v === 'inactive') { s.setShowInactive(!s.showInactive); return }
            setMore(false)
            if (v === 'import') setSheet('import')
            else if (v === 'new') setSheet('plan')
            else if (v === 'close') setSheet('close')
            else if (v === 'open' && plan && org) void api().openUrl(planUrl(org, project.name, plan.id))
          }}
        />
      </div>

      {plan && plan.state !== 'Inactive' && <VersionBar plan={plan} lookups={lookups} onStart={() => setSheet('start')} />}
      {plan?.state === 'Inactive' && <div className="ts-note"><span className="msg"><b>{plan.name}</b> is closed. Its results and runs are kept; reopen it to test again.</span><button type="button" className="btn sm" onClick={() => void s.setPlanState('Active')}>Reopen</button></div>}

      {s.plansError && (
        <div className="ts-note danger">
          <span className="msg">{s.plansError}</span>
          <button type="button" className="btn sm primary" onClick={() => void s.loadPlans()}>Try again</button>
        </div>
      )}

      {s.plansLoading && !s.plans.length ? (
        <div className="empty-state"><span className="spinner lg" /><p>Loading test plans…</p></div>
      ) : !plan ? (
        !s.plansError && (
          <Empty icon={<ClipboardList size={28} />} title="No test plans yet" action={<button type="button" className="btn primary" onClick={() => setSheet('plan')}><Plus size={14} /> New plan</button>}>
            Make a plan for the release you are testing. Its suites can follow your requirements, so results trace back to them.
          </Empty>
        )
      ) : (
        <div className="tc-split">
          <SuiteTree plan={plan} totals={totals} onSheet={setSheet} />
          <section className="tc-editor tp-main">
            {s.suitesLoading ? <div className="empty-state"><span className="spinner lg" /></div>
              : s.runningId != null ? <PointRunner plan={plan} lookups={lookups} />
              : s.tab === 'report' ? <PlanReport plan={plan} lookups={lookups} />
              : <PointsPanel lookups={lookups} onAdd={(id) => setSheet({ add: id })} />}
          </section>
        </div>
      )}

      {sheet === 'close' && plan && <CloseProjectSheet plan={plan} lookups={lookups} onClose={() => setSheet(null)} />}
      {sheet === 'start' && plan && <StartRunSheet plan={plan} onClose={() => setSheet(null)} />}
      {sheet === 'plan' && <NewPlanSheet lookups={lookups} onClose={() => setSheet(null)} />}
      {sheet === 'import' && plan && <ImportResultsSheet plan={plan} lookups={lookups} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && 'suite' in sheet && <NewSuiteSheet kind={sheet.suite} parentId={sheet.parentId} lookups={lookups} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && 'add' in sheet && <AddCasesSheet suiteId={sheet.add} lookups={lookups} onClose={() => setSheet(null)} />}
    </div>
  )
}

function SuiteTree({ plan, totals, onSheet }: { plan: TpPlan; totals: Map<number, Counts>; onSheet: (s: SheetKind) => void }) {
  const s = usePlanStore(useShallow((st) => ({ suites: st.suites, suiteId: st.suiteId, selectSuite: st.selectSuite, setRunning: st.setRunning })))
  const [menu, setMenu] = useState<{ el: HTMLElement; suite: TpSuite } | null>(null)
  const children = useMemo(() => {
    const m = new Map<number, TpSuite[]>()
    for (const x of s.suites) if (x.parentId != null) m.set(x.parentId, [...(m.get(x.parentId) ?? []), x])
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return m
  }, [s.suites])
  const root = s.suites.find((x) => x.id === plan.rootSuiteId) ?? s.suites.find((x) => x.parentId == null)

  const row = (suite: TpSuite, depth: number, seen: Set<number>): React.ReactNode => {
    const c = totals.get(suite.id)
    const Icon = suite.suiteType === 'requirementTestSuite' ? FileCheck2 : suite.suiteType === 'dynamicTestSuite' ? Tag : Folder
    return (
      <div key={suite.id}>
        <div className={`tp-suite ${s.suiteId === suite.id ? 'sel' : ''}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => { s.setRunning(null); s.selectSuite(suite.id) }}>
          <Icon size={14} className="tp-suite-ic" />
          <span className="tp-suite-name" title={suite.name}>{suite.name}</span>
          {c && <span className="faint tp-suite-n">{c.passed}/{c.total}</span>}
          {suite.suiteType === 'staticTestSuite' && (
            <button type="button" className="icon-btn sm tp-suite-add" title="Add to this suite" onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, suite }) }}><Plus size={13} /></button>
          )}
        </div>
        {c && c.total > 0 && <div className="tp-suite-bar" style={{ paddingLeft: 32 + depth * 16 }}><OutcomeBar counts={c} /></div>}
        {(children.get(suite.id) ?? []).filter((k) => !seen.has(k.id)).map((k) => row(k, depth + 1, new Set([...seen, k.id])))}
      </div>
    )
  }

  type Act = 'cases' | NewSuiteKind
  return (
    <aside className="tc-tree tp-tree">
      <div className="tp-tree-scroll">{root ? row(root, 0, new Set([root.id])) : <div className="faint tc-run-empty">This plan has no suites.</div>}</div>
      {menu && (
        <Dropdown<Act>
          anchor={menu.el}
          open
          onClose={() => setMenu(null)}
          width={240}
          options={[
            { value: 'cases', label: 'Add test cases…', icon: <ListPlus size={14} /> },
            { value: 'requirement', label: 'Add requirement suites…', icon: <FileCheck2 size={14} /> },
            { value: 'static', label: 'New suite…', icon: <FolderPlus size={14} /> },
            { value: 'tag', label: 'New tag-based suite…', icon: <Tag size={14} /> },
          ]}
          onSelect={(v) => {
            const id = menu.suite.id
            setMenu(null)
            onSheet(v === 'cases' ? { add: id } : { suite: v, parentId: id })
          }}
        />
      )}
    </aside>
  )
}

const OUTCOMES: { v: OutcomeFilter; l: string }[] = [
  { v: 'all', l: 'All outcomes' }, { v: 'notRun', l: 'Not run' }, { v: 'failed', l: 'Failed' }, { v: 'blocked', l: 'Blocked' }, { v: 'passed', l: 'Passed' }, { v: 'na', l: 'N/A' },
]

function PointsPanel({ lookups, onAdd }: { lookups: PlanLookups; onAdd: (suiteId: number) => void }) {
  const me = useAppStore((a) => a.account())
  const org = useAppStore((a) => a.activeOrg)
  const projectId = useAppStore((a) => a.selectedProject?.id)
  const planProject = usePlanStore((st) => st.project)
  const [result, setResult] = useState<{ runId: number; resultId: number } | null>(null)
  const s = usePlanStore(useShallow((st) => ({
    suites: st.suites, suiteId: st.suiteId, points: st.points, pointsLoading: st.pointsLoading, pointsError: st.pointsError, configurations: st.configurations,
    outcome: st.outcome, configurationId: st.configurationId, mine: st.mine, search: st.search, selected: st.selected,
    setOutcome: st.setOutcome, setConfigurationId: st.setConfigurationId, setMine: st.setMine, setSearch: st.setSearch, toggleSelected: st.toggleSelected, setSelected: st.setSelected,
    setRunning: st.setRunning, updatePoints: st.updatePoints, mark: st.mark, removeCases: st.removeCases, loadPoints: st.loadPoints,
  })))
  const [assignAt, setAssignAt] = useState<HTMLElement | null>(null)
  const [people, setPeople] = useState<Identity[]>([])
  const assignBtn = useRef<HTMLButtonElement>(null)
  const suite = s.suites.find((x) => x.id === s.suiteId)
  // A suite shows its own points and those of the suites under it, so the plan's root shows the whole plan.
  const under = useMemo(() => (s.suiteId == null ? [] : suiteAndBelow(s.suites, s.suiteId)), [s.suites, s.suiteId])
  const overlay = useVersionOverlay()
  const own = useMemo(() => withVersion(under.flatMap((id) => s.points[id] ?? []), overlay), [under, s.points, overlay])
  const nested = under.length > 1
  const suiteName = useMemo(() => new Map(s.suites.map((x) => [x.id, x.name])), [s.suites])
  const labels = useMemo(() => new Map([...lookups.cases].map(([id, c]) => [id, c.label])), [lookups.cases])
  const shown = useMemo(() => visiblePoints(own, { outcome: s.outcome, configurationId: s.configurationId, mine: s.mine, search: s.search, userId: me?.userId, labels }), [own, s.outcome, s.configurationId, s.mine, s.search, me, labels])
  const sel = shown.filter((p) => s.selected.has(p.id))
  const loading = under.some((id) => s.pointsLoading[id]) && !own.length
  const configs = useMemo(() => [...new Map(own.map((p) => [p.configurationId, p.configurationName])).entries()], [own])

  const openAssign = async () => {
    setAssignAt(assignBtn.current)
    if (people.length || !org || !projectId) return
    const fromPoints = new Map(Object.values(s.points).flat().flatMap((p) => (p.tester ? [[p.tester.id, { id: p.tester.id, displayName: p.tester.displayName, uniqueName: p.tester.uniqueName } as Identity] as const] : [])))
    const members = await api().prProjectMembers(org, projectId).catch(() => [] as Identity[])
    for (const m of members) fromPoints.set(m.id, m)
    setPeople([...fromPoints.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)))
  }
  const mark = (o: Markable) => void (o === 'reset' ? s.updatePoints(sel.map((p) => p.id), { outcome: o }) : s.mark(sel.map((p) => p.id), o))
  // Only static suites hold test cases directly; requirement suites follow their links.
  const removable = sel.filter((p) => s.suites.find((x) => x.id === p.suiteId)?.suiteType === 'staticTestSuite')
  const remove = async () => {
    const bySuite = new Map<number, number[]>()
    for (const p of removable) bySuite.set(p.suiteId, [...new Set([...(bySuite.get(p.suiteId) ?? []), p.testCaseId])])
    const n = [...bySuite.values()].reduce((k, ids) => k + ids.length, 0)
    const where = bySuite.size === 1 ? `"${suiteName.get([...bySuite.keys()][0])}"` : `${bySuite.size} suites`
    const ok = await confirmAsync(`Take ${n} test case${n === 1 ? '' : 's'} out of ${where}? Their results there go with them; the test cases stay.`, { title: 'Remove from suite', okLabel: 'Remove', danger: true })
    if (ok) for (const [sid, ids] of bySuite) await s.removeCases(sid, ids)
  }

  if (!suite) return <Empty title="Choose a suite">Pick a suite on the left to see its test points.</Empty>

  return (
    <div className="tp-points">
      <div className="req-bar tp-bar-row">
        <div className="search-box">
          <Search size={14} />
          <input value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder="Find by ID or title" onKeyDown={(e) => e.key === 'Escape' && s.setSearch('')} />
          {s.search && <button type="button" className="clear" onClick={() => s.setSearch('')}><X size={13} /></button>}
        </div>
        <select className="input tp-filter" value={s.outcome} onChange={(e) => s.setOutcome(e.target.value as OutcomeFilter)} aria-label="Outcome">
          {OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        {configs.length > 1 && (
          <select className="input tp-filter" value={s.configurationId ?? ''} onChange={(e) => s.setConfigurationId(e.target.value ? Number(e.target.value) : null)} aria-label="Configuration">
            <option value="">All configurations</option>
            {configs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <button type="button" className={`btn sm ${s.mine ? 'on' : ''}`} onClick={() => s.setMine(!s.mine)}>Assigned to me</button>
        <span className="grow" />
        <span className="faint">{shown.length} of {own.length} points</span>
        {suite.suiteType === 'staticTestSuite' && <button type="button" className="btn sm" onClick={() => onAdd(suite.id)}><ListPlus size={13} /> Add test cases</button>}
        {shown.some((p) => bucketOf(p.outcome) === 'notRun') && (
          <button type="button" className="btn sm primary" onClick={() => s.setRunning(shown.find((p) => bucketOf(p.outcome) === 'notRun')!.id)}><PlayCircle size={13} /> Run next</button>
        )}
      </div>
      {suite.suiteType === 'dynamicTestSuite' && <div className="faint tp-hint">{suite.tag ? <>This suite holds every test case tagged <b>{suite.tag}</b>: tag test cases in Test Cases and they appear here.</> : 'This suite is filled by a query in Azure DevOps.'}</div>}
      {suite.suiteType === 'requirementTestSuite' && <div className="faint tp-hint">This suite follows requirement {lookups.reqs.get(suite.requirementId ?? 0)?.label ?? `#${suite.requirementId}`}: link test cases to it in Test Cases and they appear here.</div>}
      {s.pointsError && <div className="ts-note danger"><span className="msg">{s.pointsError}</span><button type="button" className="btn sm primary" onClick={() => { for (const id of under) void s.loadPoints(id, { force: true }) }}>Try again</button></div>}

      {loading ? <div className="empty-state"><span className="spinner lg" /></div> : own.length === 0 ? (
        <Empty title="No test points in this suite">{suite.suiteType === 'staticTestSuite' ? 'Add test cases, or suites under this one, to start testing; each test case gets one point per configuration.' : suite.suiteType === 'dynamicTestSuite' ? 'No test case matches this suite\'s tag yet.' : 'No test case is linked to this requirement yet.'}</Empty>
      ) : (
        <div className="list tp-list">
          <table>
            <thead>
              <tr>
                <th className="tp-chk"><input type="checkbox" aria-label="Select all" checked={sel.length > 0 && sel.length === shown.length} onChange={(e) => s.setSelected(e.target.checked ? shown.map((p) => p.id) : [])} /></th>
                <th>ID</th><th>Title</th><th>Configuration</th><th>Tester</th><th>Outcome</th><th>Last run</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={s.selected.has(p.id) ? 'selected' : ''} onClick={() => s.toggleSelected(p.id)} onDoubleClick={() => s.setRunning(p.id)}>
                  <td className="tp-chk"><input type="checkbox" aria-label={`Select ${p.testCaseTitle}`} checked={s.selected.has(p.id)} onChange={() => s.toggleSelected(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="tp-id">{lookups.label(p.testCaseId)}</td>
                  <td className="title">
                    {p.testCaseTitle}{p.isAutomated && <Bot size={13} className="tp-auto" aria-label="Last run was automated" />}
                    {nested && p.suiteId !== suite.id && <div className="tp-sub" title={suiteName.get(p.suiteId)}>{suiteName.get(p.suiteId)}</div>}
                  </td>
                  <td>{p.configurationName}</td>
                  <td>{p.tester?.displayName ?? <span className="faint">Unassigned</span>}</td>
                  <td><LastResultPill point={p} /></td>
                  <td className="muted" title={p.lastRunDate ? `${new Date(p.lastRunDate).toLocaleString()}${p.lastRunBy ? ` by ${p.lastRunBy}` : ''}` : undefined}>{p.lastRunDate ? relativeTime(p.lastRunDate) : '—'}</td>
                  <td className="tp-go">
                    <span className="tp-go-btns">
                      {p.lastRunId != null && p.lastResultId != null && <button type="button" className="btn sm tp-result-btn" title="Open the last recorded result: steps, error, screenshots and logs" onClick={(e) => { e.stopPropagation(); setResult({ runId: p.lastRunId!, resultId: p.lastResultId! }) }} onDoubleClick={(e) => e.stopPropagation()}><FileSearch size={13} /> Result</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty-state"><h3>No points match</h3><p>Try clearing a filter.</p></div>}
        </div>
      )}

      {result && planProject && <ResultSheet project={planProject} runId={result.runId} resultId={result.resultId} onClose={() => setResult(null)} />}
      {sel.length > 0 && (
        <div className="bulk-bar">
          <span className="n">{sel.length} selected</span>
          <button type="button" className="btn sm" onClick={() => mark('passed')}><Check size={13} /> Pass</button>
          <button type="button" className="btn sm" onClick={() => mark('failed')}><X size={13} /> Fail</button>
          <button type="button" className="btn sm" onClick={() => mark('blocked')}>Blocked</button>
          <button type="button" className="btn sm" onClick={() => mark('notApplicable')}>N/A</button>
          <button type="button" className="btn sm" onClick={() => mark('reset')} title="Make the points not run again">Reset</button>
          {me && <button type="button" className="btn sm" onClick={() => void s.updatePoints(sel.map((p) => p.id), { testerId: me.userId })}>Assign to me</button>}
          <button ref={assignBtn} type="button" className="btn sm" onClick={() => void openAssign()}>Assign…</button>
          {removable.length > 0 && <button type="button" className="btn sm danger" onClick={() => void remove()} title={removable.length < sel.length ? 'Points in requirement suites stay: they follow the requirement\'s links' : undefined}>Remove</button>}
          <button type="button" className="icon-btn sm" onClick={() => s.setSelected([])} title="Clear selection"><X size={14} /></button>
        </div>
      )}
      {assignAt && (
        <Dropdown<string>
          anchor={assignAt}
          open
          searchable
          placeholder="Find a person"
          onClose={() => setAssignAt(null)}
          options={people.map((p) => ({ value: p.id, label: p.displayName }))}
          emptyLabel={people.length ? 'No matches' : 'Loading people…'}
          onSelect={(id) => { setAssignAt(null); void s.updatePoints(sel.map((p) => p.id), { testerId: id }) }}
        />
      )}
    </div>
  )
}

function PointRunner({ plan, lookups }: { plan: TpPlan; lookups: PlanLookups }) {
  const me = useAppStore((a) => a.account())
  const s = usePlanStore(useShallow((st) => ({
    points: st.points, suiteId: st.suiteId, runningId: st.runningId, outcome: st.outcome, configurationId: st.configurationId, mine: st.mine, search: st.search,
    setRunning: st.setRunning, afterRun: st.afterRun, mark: st.mark, version: st.version, project: st.project,
  })))
  // What was recorded before: the last result, or the test case's whole history.
  const [past, setPast] = useState<null | 'history' | { runId: number; resultId: number }>(null)
  const tc = useTcStore(useShallow((st) => ({ cfg: st.cfg, shared: st.shared, loading: st.loading })))
  const reqCfg = useReqStore((r) => r.cfg)
  const sharedById = useMemo(() => new Map(tc.shared.map((w) => [w.id, w])), [tc.shared])
  const labels = useMemo(() => new Map([...lookups.cases].map(([id, c]) => [id, c.label])), [lookups.cases])
  // Work through the list as it was filtered when the run started.
  const overlay = useVersionOverlay()
  const queue = useMemo(() => visiblePoints(withVersion(s.suiteId != null ? suiteAndBelow(usePlanStore.getState().suites, s.suiteId).flatMap((id) => s.points[id] ?? []) : [], overlay), { outcome: 'all', configurationId: s.configurationId, mine: s.mine, search: s.search, userId: me?.userId, labels }), [s.points, s.suiteId, s.configurationId, s.mine, s.search, me, labels, overlay]) // eslint-disable-line react-hooks/exhaustive-deps
  const point = withVersion(Object.values(s.points).flat(), overlay).find((p) => p.id === s.runningId)
  if (!point) return <Empty title="This test point is gone">It may have been removed from the suite.</Empty>
  const i = queue.findIndex((p) => p.id === point.id)
  const nextNotRun = queue.slice(i + 1).find((p) => bucketOf(p.outcome) === 'notRun') ?? queue.slice(i + 1)[0]
  const next = () => s.setRunning(nextNotRun?.id ?? null)
  const test = lookups.tests.get(point.testCaseId)

  return (
    <div className="tp-runner">
      <div className="tp-runner-bar">
        <button type="button" className="btn sm ghost" onClick={() => s.setRunning(null)}><ArrowLeft size={14} /> Points</button>
        <span className="faint">{i >= 0 ? `${i + 1} of ${queue.length}` : ''} · {plan.name}</span>
        <span className="grow" />
        <OutcomePill outcome={point.outcome} />
        {point.lastRunDate ? <span className="faint">{relativeTime(point.lastRunDate)}{point.lastRunBy ? ` by ${point.lastRunBy}` : ''}</span> : <span className="faint">Not run yet</span>}
        {point.lastRunId != null && point.lastResultId != null && <button type="button" className="btn sm" onClick={() => setPast({ runId: point.lastRunId!, resultId: point.lastResultId! })} title="What was recorded last time: steps, error, screenshots and logs"><FileSearch size={13} /> Last result</button>}
        <button type="button" className="btn sm" onClick={() => setPast('history')} title="Every recorded result of this test case"><History size={13} /> History</button>
      </div>
      {test && tc.cfg && reqCfg ? (
        <RunCase
          key={point.id}
          cfg={tc.cfg}
          reqCfg={reqCfg}
          tree={lookups.tree}
          test={test}
          release={s.version ?? releaseOf(plan)}
          shared={sharedById}
          point={{ planId: plan.id, pointId: point.id, configurationName: point.configurationName }}
          onRecorded={() => void s.afterRun([point.suiteId])}
          onNext={next}
        />
      ) : tc.loading ? (
        <div className="empty-state"><span className="spinner lg" /><p>Loading the test case…</p></div>
      ) : (
        <QuickMark point={point} onMarked={next} onMark={(o) => s.mark([point.id], o)} />
      )}
      {past === 'history' && s.project && <RunHistorySheet testCaseId={point.testCaseId} title={point.testCaseTitle} project={s.project} onClose={() => setPast(null)} />}
      {past && past !== 'history' && s.project && <ResultSheet project={s.project} runId={past.runId} resultId={past.resultId} onClose={() => setPast(null)} />}
    </div>
  )
}

/** For a test case Boards cannot show step by step (another project's process, or not loaded): mark the outcome only. */
function QuickMark({ point, onMark, onMarked }: { point: TpPoint; onMark: (o: Exclude<Markable, 'reset'>) => Promise<boolean>; onMarked: () => void }) {
  const go = async (o: Exclude<Markable, 'reset'>) => { if (await onMark(o)) onMarked() }
  return (
    <div className="tc-ed">
      <div className="tc-ed-top"><span className="tc-sdv tc-sdv-ro">#{point.testCaseId}</span><strong className="tc-title">{point.testCaseTitle}</strong><span className="tp-config">{point.configurationName}</span></div>
      <p className="faint">The steps of this test case are not available here, so only its outcome can be set.</p>
      <div className="tc-run-actions">
        <button type="button" className="btn" onClick={() => void go('blocked')}>Blocked</button>
        <button type="button" className="btn" onClick={() => void go('notApplicable')}>N/A</button>
        <span className="grow" />
        <button type="button" className="btn danger" onClick={() => void go('failed')}><X size={14} /> Fail</button>
        <button type="button" className="btn primary" onClick={() => void go('passed')}><Check size={14} /> Pass</button>
      </div>
    </div>
  )
}
