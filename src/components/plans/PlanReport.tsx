import { Copy, FileSpreadsheet, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { copyRichText, wordDocument } from '@/lib/docExport'
import { relativeTime } from '@/lib/format'
import { buildReport, esc, pct, pointsCsv, rates, reportHtml, reqStatusLabel, type Group } from '@/lib/testplans/report'
import type { TpPlan } from '@/lib/testplans/types'
import { useVersionOverlay, usePlanStore } from '@/store/usePlanStore'
import { withVersion } from '@/lib/testplans/versions'
import { useUiStore } from '@/store/useUiStore'
import type { PlanLookups } from './lookups'
import { OutcomeBar, OutcomePill } from './bits'

/** The plan at a glance: progress, where it fails, and which requirements are verified. */
export function PlanReport({ plan, lookups }: { plan: TpPlan; lookups: PlanLookups }) {
  const suites = usePlanStore((s) => s.suites)
  const points = usePlanStore((s) => s.points)
  const setRunning = usePlanStore((s) => s.setRunning)
  const selectSuite = usePlanStore((s) => s.selectSuite)
  const toast = useUiStore((u) => u.toast)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setLoading(true); void usePlanStore.getState().loadAllPoints().then(() => setLoading(false)) }, [plan.id])

  const overlay = useVersionOverlay()
  const version = usePlanStore((s) => (s.view === 'version' ? s.version : null))
  const all = useMemo(() => withVersion(Object.values(points).flat(), overlay), [points, overlay])
  const report = useMemo(() => buildReport(suites, all, lookups.cases, lookups.reqs), [suites, all, lookups])
  const c = report.counts
  const r = rates(c)
  const title = `${plan.name}${version ? ` – Version ${version}` : ''} – Test Report`
  // Plan names come from Azure DevOps and go into HTML.
  const titleHtml = esc(title)

  const saveWord = async () => {
    const path = await api().pickSavePath(`${title}.doc`, { name: 'Word document', extensions: ['doc'] })
    if (!path) return
    await api().writeTextFile(path, wordDocument(titleHtml, reportHtml(plan, report, lookups.cases, new Date().toLocaleString())))
    toast({ kind: 'success', title: 'Report saved' })
  }
  const saveCsv = async () => {
    const path = await api().pickSavePath(`${plan.name} – Test Points.csv`)
    if (!path) return
    await api().writeTextFile(path, pointsCsv(suites, all, lookups.cases, lookups.reqs))
    toast({ kind: 'success', title: 'Test points saved' })
  }
  const copy = () => {
    const holder = document.createElement('div')
    holder.innerHTML = `<h1>${titleHtml}</h1>${reportHtml(plan, report, lookups.cases, new Date().toLocaleString())}`
    const ok = copyRichText(holder)
    toast({ kind: ok ? 'success' : 'error', title: ok ? 'Report copied' : 'Could not copy' })
  }

  if (loading && !all.length) return <div className="empty-state"><span className="spinner lg" /><p>Reading every suite…</p></div>

  const tiles: [string, string | number, string?][] = [
    ['Pass rate', pct(r.pass), 'passed'], ['Run', pct(r.run)], ['Passed', c.passed, 'passed'], ['Failed', c.failed, 'failed'], ['Blocked', c.blocked, 'blocked'], ['Not run', c.notRun],
  ]

  return (
    <div className="tp-report">
      <div className="tp-report-bar">
        <b>{c.total} test points</b><span className="faint">in {suites.length} suite{suites.length === 1 ? '' : 's'}{loading ? ' · updating…' : ''}</span>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={copy}><Copy size={13} /> Copy</button>
        <button type="button" className="btn sm" onClick={() => void saveWord()}><FileText size={13} /> Word</button>
        <button type="button" className="btn sm" onClick={() => void saveCsv()}><FileSpreadsheet size={13} /> CSV</button>
      </div>
      <div className="tp-tiles">
        {tiles.map(([label, value, kind]) => <div key={label} className={`tp-tile ${kind ?? ''}`}><span className="v">{value}</span><span className="l">{label}</span></div>)}
      </div>
      <OutcomeBar counts={c} />

      <div className="tp-report-grid">
        <GroupTable title="Suites" groups={report.bySuite} onPick={(key) => { selectSuite(Number(key)); usePlanStore.getState().setTab('points') }} />
        <GroupTable title="Configurations" groups={report.byConfiguration} />
        <GroupTable title="Testers" groups={report.byTester} />
      </div>

      {report.requirements.length > 0 && (
        <section className="tp-section">
          <h3>Requirements</h3>
          <div className="list"><table>
            <thead><tr><th>Requirement</th><th>Title</th><th>Points</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>{report.requirements.map((q) => (
              <tr key={q.id}><td className="tp-id">{q.label}</td><td className="title">{q.title}</td><td className="num">{q.counts.total}</td><td><OutcomeBar counts={q.counts} /></td><td><span className={`tp-pill req-${q.status}`}>{reqStatusLabel(q.status)}</span></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <section className="tp-section">
        <h3>Failed and blocked {report.failures.length ? `(${report.failures.length})` : ''}</h3>
        {report.failures.length ? (
          <div className="list"><table>
            <thead><tr><th>ID</th><th>Title</th><th>Configuration</th><th>Outcome</th><th>Last run</th></tr></thead>
            <tbody>{report.failures.map((p) => (
              <tr key={p.id} onClick={() => { selectSuite(p.suiteId); setRunning(p.id) }} className="tp-click"><td className="tp-id">{lookups.label(p.testCaseId)}</td><td className="title">{p.testCaseTitle}</td><td>{p.configurationName}</td><td><OutcomePill outcome={p.outcome} /></td><td className="muted">{p.lastRunDate ? `${relativeTime(p.lastRunDate)}${p.lastRunBy ? ` · ${p.lastRunBy}` : ''}` : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="faint">Nothing has failed or is blocked.</p>}
      </section>
    </div>
  )
}

function GroupTable({ title, groups, onPick }: { title: string; groups: Group[]; onPick?: (key: string) => void }) {
  if (!groups.length) return null
  return (
    <section className="tp-section">
      <h3>{title}</h3>
      <div className="list"><table>
        <thead><tr><th>{title.replace(/s$/, '')}</th><th className="num">Points</th><th>Progress</th><th className="num">Pass rate</th></tr></thead>
        <tbody>{groups.map((g) => (
          <tr key={g.key} className={onPick ? 'tp-click' : ''} onClick={onPick ? () => onPick(g.key) : undefined}>
            <td className="title">{g.label}</td><td className="num">{g.counts.total}</td><td><OutcomeBar counts={g.counts} /></td><td className="num">{pct(rates(g.counts).pass)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}
