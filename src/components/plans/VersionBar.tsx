import { Archive, Check, FileText, PlayCircle, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { Sheet } from '@/components/ui/Sheet'
import { confirmAsync } from '@/lib/confirm'
import { suiteAndBelow } from '@/lib/testplans/report'
import type { TpPlan, TpSuite } from '@/lib/testplans/types'
import { planVersions, usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import type { PlanLookups } from './lookups'
import { UntaggedNote, useTagVersions } from './TagVersions'
import { exportVersionReport } from './versionExport'

const NEW = '__new'

/** Which version is under test: runs, imports and marks are tagged with it, and points can be shown as they were on it. */
export function VersionBar({ plan, lookups, onStart }: { plan: TpPlan; lookups: PlanLookups; onStart: () => void }) {
  const s = usePlanStore(useShallow((st) => ({
    version: st.version, view: st.view, runs: st.runs, addedVersions: st.addedVersions, versionLoading: st.versionLoading,
    setVersion: st.setVersion, addVersion: st.addVersion, setView: st.setView,
  })))
  const versions = useMemo(() => planVersions(s), [s.runs, s.addedVersions]) // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useTagVersions()
  // Tags first; versions only this plan used (typed, or from imports) after them.
  const used = versions.filter((v) => !tags.offered.includes(v))
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const add = () => { if (text.trim()) { s.addVersion(text); setAdding(false); setText('') } }
  const reportBtn = useRef<HTMLButtonElement>(null)
  const [reportMenu, setReportMenu] = useState(false)

  return (
    <div className="req-bar tp-version-bar">
      <label className="faint" htmlFor="tp-version">Testing version</label>
      {adding ? (
        <span className="form-inline">
          <input id="tp-version" className="input tp-version-input" value={text} autoFocus placeholder="e.g. 0.4.0" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false) }} />
          <button type="button" className="icon-btn sm" title="Add" onClick={add} disabled={!text.trim()}><Check size={14} /></button>
          <button type="button" className="icon-btn sm" title="Cancel" onClick={() => setAdding(false)}><X size={14} /></button>
        </span>
      ) : (
        <select id="tp-version" className="input tp-filter" value={s.version ?? ''} onChange={(e) => (e.target.value === NEW ? setAdding(true) : s.setVersion(e.target.value || null))}>
          <option value="">None</option>
          {tags.offered.length > 0 && <optgroup label={`Tags in ${tags.repoName ?? 'the repository'}`}>{tags.offered.map((v) => <option key={v} value={v}>{v}</option>)}</optgroup>}
          {used.length > 0 && (tags.offered.length > 0 ? <optgroup label="Used in this plan">{used.map((v) => <option key={v} value={v}>{v}</option>)}</optgroup> : used.map((v) => <option key={v} value={v}>{v}</option>))}
          {s.version && !versions.includes(s.version) && !tags.offered.includes(s.version) && <option value={s.version}>{s.version}</option>}
          <option value={NEW}>New version…</option>
        </select>
      )}
      <UntaggedNote version={s.version} />
      {s.version && (
        <div className="segmented small">
          <button type="button" className={s.view === 'latest' ? 'on' : ''} onClick={() => s.setView('latest')} title="Each point's latest outcome, whatever version it was on">Latest</button>
          <button type="button" className={s.view === 'version' ? 'on' : ''} onClick={() => s.setView('version')} title={`Outcomes from the runs on ${s.version} only`}>On {s.version}</button>
        </div>
      )}
      {s.versionLoading && <span className="spinner" />}
      <span className="grow" />
      {s.version && <button ref={reportBtn} type="button" className="btn sm" onClick={() => setReportMenu(true)} title="The record of this version: every result, the run IDs behind them, coverage and a sign-off block"><FileText size={13} /> Version report</button>}
      <button type="button" className="btn sm" onClick={onStart}><PlayCircle size={13} /> Start run…</button>
      {reportMenu && s.version && (
        <Dropdown<'word' | 'csv'>
          anchor={reportBtn.current}
          open
          align="right"
          onClose={() => setReportMenu(false)}
          options={[{ value: 'word', label: 'Word document', sub: 'For the release file' }, { value: 'csv', label: 'CSV', sub: 'One row per test point' }]}
          onSelect={(f) => { setReportMenu(false); void exportVersionReport(plan, s.version!, lookups, f) }}
        />
      )}
    </div>
  )
}

/** Begin testing a version on some suites: their points go back to not run, so each one has to be run on this build. */
export function StartRunSheet({ plan, onClose }: { plan: TpPlan; onClose: () => void }) {
  const s = usePlanStore(useShallow((st) => ({ suites: st.suites, points: st.points, version: st.version, runs: st.runs, addedVersions: st.addedVersions, startRun: st.startRun, loadAllPoints: st.loadAllPoints })))
  const toast = useUiStore((u) => u.toast)
  const versions = useMemo(() => planVersions(s), [s.runs, s.addedVersions]) // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useTagVersions()
  const [version, setVersion] = useState(s.version ?? '')
  const [picked, setPicked] = useState<Set<number>>(() => new Set([plan.rootSuiteId]))
  const [busy, setBusy] = useState(false)
  useEffect(() => { void s.loadAllPoints() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const children = useMemo(() => {
    const m = new Map<number, TpSuite[]>()
    for (const x of s.suites) if (x.parentId != null) m.set(x.parentId, [...(m.get(x.parentId) ?? []), x])
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return m
  }, [s.suites])
  const scope = useMemo(() => [...new Set([...picked].flatMap((id) => suiteAndBelow(s.suites, id)))], [picked, s.suites])
  const count = useMemo(() => new Set(scope.flatMap((id) => (s.points[id] ?? []).map((p) => p.id))).size, [scope, s.points])
  const root = s.suites.find((x) => x.id === plan.rootSuiteId)
  const covered = (id: number): boolean => { const x = s.suites.find((y) => y.id === id); return !!x?.parentId && (picked.has(x.parentId) || covered(x.parentId)) }

  const toggle = (id: number, on: boolean) => setPicked((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n })
  const start = async () => {
    const v = version.trim()
    const ok = await confirmAsync(`Set ${count} test point${count === 1 ? '' : 's'} back to "not run" for version ${v}? Earlier results stay in their runs and in the reports of earlier versions.`, { title: 'Start run', okLabel: 'Start run', danger: true })
    if (!ok) return
    setBusy(true)
    const n = await s.startRun(v, scope)
    setBusy(false)
    if (n) { toast({ kind: 'success', title: `Testing ${v}`, detail: `${n} test point${n === 1 ? '' : 's'} to run.` }); onClose() }
  }

  const row = (x: TpSuite, depth: number): React.ReactNode => (
    <div key={x.id}>
      <label className={`tp-pick ${covered(x.id) ? 'off' : ''}`} style={{ paddingLeft: 10 + depth * 18 }}>
        <input type="checkbox" checked={picked.has(x.id) || covered(x.id)} disabled={covered(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} />
        <span className="tp-pick-title">{x.id === plan.rootSuiteId ? `Whole plan (${x.name})` : x.name}</span>
        <span className="faint">{(s.points[x.id] ?? []).length || ''}</span>
      </label>
      {(children.get(x.id) ?? []).map((k) => row(k, depth + 1))}
    </div>
  )

  return (
    <Sheet
      title="Start run"
      onClose={onClose}
      footer={<><span className="faint grow">{count} test point{count === 1 ? '' : 's'} will be set to not run</span><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" disabled={busy || !version.trim() || !count} onClick={() => void start()}>{busy ? 'Starting…' : 'Start run'}</button></>}
    >
      <p className="faint tp-note">Choose the build you are testing and what to run on it, for example only Smoke on 0.3.0, or everything on 1.0.0. Runs, imports and marks from now on are tagged with this version.</p>
      <div className="form-row">
        <label htmlFor="tp-start-version">Version</label>
        <div>
          <input id="tp-start-version" className="input" list="tp-start-versions" value={version} placeholder="e.g. 0.4.0" autoFocus onChange={(e) => setVersion(e.target.value)} />
          <datalist id="tp-start-versions">{[...new Set([...tags.offered, ...versions])].map((v) => <option key={v} value={v} />)}</datalist>
          <UntaggedNote version={version} />
        </div>
      </div>
      <div className="form-row stack">
        <label>Suites to run</label>
        <div className="tp-pick-list">{root ? row(root, 0) : <div className="faint tc-run-empty">This plan has no suites.</div>}</div>
      </div>
    </Sheet>
  )
}

/** End of the project: save the last version's report, then set the plan Inactive. Nothing in it is removed. */
export function CloseProjectSheet({ plan, lookups, onClose }: { plan: TpPlan; lookups: PlanLookups; onClose: () => void }) {
  const s = usePlanStore(useShallow((st) => ({ version: st.version, runs: st.runs, addedVersions: st.addedVersions, setPlanState: st.setPlanState, loadPlans: st.loadPlans })))
  const toast = useUiStore((u) => u.toast)
  const versions = useMemo(() => planVersions(s), [s.runs, s.addedVersions]) // eslint-disable-line react-hooks/exhaustive-deps
  const [version, setVersion] = useState(s.version ?? versions[0] ?? '')
  const [exportFirst, setExportFirst] = useState(true)
  const [busy, setBusy] = useState(false)

  const close = async () => {
    setBusy(true)
    if (exportFirst && version && !(await exportVersionReport(plan, version, lookups, 'word'))) { setBusy(false); return }
    const ok = await confirmAsync(`Close ${plan.name}? It becomes inactive: it leaves the plan list, and its suites, results and runs stay in Azure DevOps. You can reopen it from "Inactive plans".`, { title: 'Close project', okLabel: 'Close plan', danger: true })
    if (!ok) { setBusy(false); return }
    const done = await s.setPlanState('Inactive')
    setBusy(false)
    if (done) { toast({ kind: 'success', title: `${plan.name} closed` }); onClose(); void s.loadPlans() }
  }

  return (
    <Sheet
      title="Close project"
      onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary danger" disabled={busy || (exportFirst && !version)} onClick={() => void close()}><Archive size={14} /> {exportFirst ? 'Save report and close' : 'Close plan'}</button></>}
    >
      <p className="faint tp-note">At the end of the project, save the final version report for the release file, then close the plan. Closing sets it Inactive in Azure DevOps; nothing is deleted.</p>
      <div className="form-row">
        <label>Final report</label>
        <div className="check-list tp-checks">
          <label><input type="checkbox" checked={exportFirst} onChange={(e) => setExportFirst(e.target.checked)} /> Save the version report (Word) first</label>
          {exportFirst && (
            <select className="input tp-filter" value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Version">
              {!versions.length && <option value="">No versions yet</option>}
              {versions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>
      </div>
    </Sheet>
  )
}
