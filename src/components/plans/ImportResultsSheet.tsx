import { AlertTriangle, Check, FileUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { api } from '@/lib/api'
import { configurationByName, matchResults, parseReport, resultsForPoints, type AutoResult, type ReportFormat } from '@/lib/testplans/results'
import { runUrl, type TpPlan, type TpPoint } from '@/lib/testplans/types'
import { errorMessage } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import type { PlanLookups } from './lookups'

const OUTCOME_LABEL: Record<AutoResult['outcome'], string> = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', flaky: 'Flaky' }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Publish automated results (Playwright JSON or JUnit XML) to the plan as one automated test run. */
export function ImportResultsSheet({ plan, lookups, onClose }: { plan: TpPlan; lookups: PlanLookups; onClose: () => void }) {
  const org = useAppStore((s) => s.activeOrg)
  const project = useAppStore((s) => s.selectedProject?.name ?? '')
  const configs = usePlanStore((s) => s.configurations)
  const toast = useUiStore((u) => u.toast)
  const [points, setPoints] = useState<TpPoint[] | null>(null)
  const [file, setFile] = useState<{ path: string; format: ReportFormat; results: AutoResult[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fallback, setFallback] = useState<number | null>(() => configs.find((c) => c.isDefault)?.id ?? configs[0]?.id ?? null)
  const [name, setName] = useState('')
  const [build, setBuild] = useState(() => usePlanStore.getState().version ?? '')
  const [busy, setBusy] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)

  useEffect(() => { void usePlanStore.getState().loadAllPoints({ force: true }).then(setPoints) }, [])
  // Configurations may arrive after the sheet opens.
  useEffect(() => { if (fallback == null && configs.length) setFallback(configs.find((c) => c.isDefault)?.id ?? configs[0].id) }, [configs]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    setError(null)
    try {
      const path = await api().pickOpenFile({ name: 'Test results', extensions: ['json', 'xml'] })
      if (!path) return
      const { format, results } = parseReport(await api().readTextFile(path))
      if (!results.length) { setError('That report has no tests in it.'); return }
      setFile({ path, format, results })
      setName(`Automated · ${baseName(path)} · ${today()}`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const matches = useMemo(() => (file && points ? matchResults(file.results, points, configs, lookups.keyToId, fallback) : []), [file, points, configs, lookups.keyToId, fallback])
  const toSend = useMemo(() => resultsForPoints(matches), [matches])
  const unmatched = matches.filter((m) => !m.pointIds.length).length
  const usesFallback = matches.some((m) => !configurationByName(m.result.project, configs))
  const loadError = usePlanStore((s) => s.pointsError)
  const shown = onlyProblems ? matches.filter((m) => m.problem) : matches

  const publish = async () => {
    setBusy(true)
    if (build.trim()) usePlanStore.getState().addVersion(build)
    const out = await usePlanStore.getState().publishRun({ planId: plan.id, name: name.trim() || 'Automated run', automated: true, buildNumber: build.trim() || undefined, results: toSend })
    setBusy(false)
    if (!out) return
    toast({
      kind: 'success', title: `Published ${out.published} result${out.published === 1 ? '' : 's'} to ${plan.name}`,
      detail: unmatched ? `${unmatched} test${unmatched === 1 ? '' : 's'} had no test point and were left out.` : undefined,
      action: org ? { label: 'Open run', onClick: () => void api().openUrl(runUrl(org, project, out.runId)) } : undefined,
    })
    onClose()
  }

  return (
    <Sheet
      title={`Import results into ${plan.name}`}
      size="wide"
      onClose={onClose}
      footer={file ? (
        <>
          <span className="faint grow">{toSend.length} test point{toSend.length === 1 ? '' : 's'} will get a result{unmatched ? ` · ${unmatched} test${unmatched === 1 ? '' : 's'} left out` : ''}</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !toSend.length} onClick={() => void publish()}>{busy ? 'Publishing…' : 'Publish run'}</button>
        </>
      ) : undefined}
    >
      {!file ? (
        <div className="tp-import-pick">
          <p>Choose a <b>Playwright JSON report</b> or a <b>JUnit XML</b> file. Each test is matched to a test case by the ID in its title, such as <code>[1234]</code>, <code>@TC1234</code> or an SDV ID, and to a configuration by its Playwright project name.</p>
          <button type="button" className="btn primary" onClick={() => void pick()} disabled={!points}><FileUp size={14} /> {points ? 'Choose a results file' : 'Reading the plan…'}</button>
          {error && <div className="ts-note danger"><span className="msg">{error}</span></div>}
          <details className="tp-howto">
            <summary>Setting up Playwright</summary>
            <pre>{`// playwright.config.ts
reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
projects: [{ name: '${configs[0]?.name ?? 'macOS'}' }, { name: '${configs[1]?.name ?? 'Windows 11'}' }],

// a test
test('[1234] signs in with SSO', async ({ page }) => { … })`}</pre>
          </details>
        </div>
      ) : (
        <>
          <div className="form-row"><label>File</label><div className="form-inline"><span className="field-text">{baseName(file.path)}</span><span className="faint">{file.format === 'playwright' ? 'Playwright JSON' : 'JUnit XML'} · {file.results.length} tests</span><button type="button" className="btn sm" onClick={() => void pick()}>Choose another</button></div></div>
          <div className="form-row"><label htmlFor="tp-run">Run name</label><input id="tp-run" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="form-row"><label htmlFor="tp-build">Version</label><input id="tp-build" className="input" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="The version these results are from, e.g. 0.4.0" /></div>
          {configs.length > 0 && (
            <div className="form-row">
              <label htmlFor="tp-cfg">Configuration</label>
              <div>
                <select id="tp-cfg" className="input" value={fallback ?? ''} onChange={(e) => setFallback(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">None</option>
                  {configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="faint tp-note">For tests whose project name is not a configuration{usesFallback ? ' (some in this file)' : ''}.</p>
              </div>
            </div>
          )}
          {error && <div className="ts-note danger"><span className="msg">{error}</span></div>}
          {loadError && <div className="ts-note danger"><span className="msg">Some suites could not be read, so their tests show as not in the plan: {loadError}</span></div>}
          <div className="tp-import-head">
            <b>{matches.length - unmatched} of {matches.length} tests matched</b>
            <span className="grow" />
            {unmatched > 0 && <label className="faint"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only show problems</label>}
          </div>
          <div className="list tp-import-list">
            <table>
              <thead><tr><th>Test</th><th>Project</th><th>Result</th><th>Test case</th><th /></tr></thead>
              <tbody>
                {shown.map((m, i) => (
                  <tr key={i}>
                    <td className="title" title={m.result.file}>{m.result.fullName}</td>
                    <td>{m.result.project ?? <span className="faint">—</span>}{m.configurationName && m.configurationName !== m.result.project && <span className="faint"> → {m.configurationName}</span>}</td>
                    <td><span className={`tp-pill ${m.result.outcome === 'flaky' ? 'passed' : m.result.outcome === 'skipped' ? 'notRun' : m.result.outcome}`}>{OUTCOME_LABEL[m.result.outcome]}</span></td>
                    <td>{m.testCaseIds.map((id) => lookups.label(id)).join(', ') || <span className="faint">—</span>}</td>
                    <td className="tp-match">{m.pointIds.length && !m.problem ? <Check size={14} className="ok" aria-label="Matched" /> : <span className="warn" title={m.problem}><AlertTriangle size={14} /> {m.problem}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  )
}
