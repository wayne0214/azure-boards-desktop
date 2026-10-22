import { FileSpreadsheet } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Fragment, useMemo, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { api } from '@/lib/api'
import { idOf, plainText } from '@/lib/requirements'
import type { Coverage } from '@/lib/testcases/coverage'
import { planImport, type ImportMapping, type PlannedCase } from '@/lib/testcases/importPlan'
import { plain } from '@/lib/testcases/steps'
import { errorMessage, type CsvData } from '@/lib/types'
import { useTcStore } from '@/store/useTcStore'
import { useUiStore } from '@/store/useUiStore'

type Target = '' | keyof ImportMapping
const TARGETS: { value: Target; label: string }[] = [
  { value: '', label: 'Skip' },
  { value: 'sdv', label: 'SDV ID (required)' },
  { value: 'srs', label: 'SRS ID' },
  { value: 'steps', label: 'Test steps' },
  { value: 'criteria', label: 'Acceptance criteria (expected results)' },
  { value: 'title', label: 'Title' },
  { value: 'preconditions', label: 'Preconditions' },
]

function guess(header: string): Target {
  const h = header.toLowerCase()
  if (/sdv/.test(h)) return 'sdv'
  if (/srs|requirement/.test(h)) return 'srs'
  if (/step/.test(h)) return 'steps'
  if (/accept|criteria/.test(h)) return 'criteria'
  if (/precond/.test(h)) return 'preconditions'
  if (/title|name|summary/.test(h)) return 'title'
  return ''
}

/** Bring test cases in from the team's spreadsheet (saved as CSV), matching SRS IDs to real requirements. */
export function TcImportSheet({ coverage, onClose }: { coverage: Coverage; onClose: () => void }) {
  const s = useTcStore(useShallow((st) => ({ cfg: st.cfg, importCases: st.importCases, tests: st.tests })))
  const toast = useUiStore((u) => u.toast)
  const [csv, setCsv] = useState<CsvData | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [phase, setPhase] = useState<'pick' | 'map' | 'running' | 'done'>('pick')
  const [results, setResults] = useState<Record<number, { id?: number; error?: string }>>({})
  const [error, setError] = useState<string | null>(null)
  // What was imported, kept as it was: the list reloads afterwards and would otherwise read as all updates.
  const [ran, setRan] = useState<PlannedCase[]>([])

  const pick = async () => {
    setError(null)
    const p = await api().pickCsvFile()
    if (!p) return
    try {
      const data = await api().readCsv(p)
      if (data.rows.length === 0) { setError('That file has no rows.'); return }
      setCsv(data); setTargets(data.headers.map(guess)); setPhase('map')
    } catch (e) { setError(errorMessage(e)) }
  }

  const mapping = useMemo((): ImportMapping | null => {
    const at = (t: Target) => { const i = targets.indexOf(t); return i < 0 ? undefined : i }
    const sdv = at('sdv')
    return sdv === undefined ? null : { sdv, srs: at('srs') ?? -1, steps: at('steps') ?? -1, criteria: at('criteria') ?? -1, title: at('title'), preconditions: at('preconditions') }
  }, [targets])

  const plan = useMemo(() => {
    if (!csv || !mapping) return []
    const srsByCode = new Map([...coverage.bySrs.values()].filter((c) => idOf(c.node)).map((c) => [idOf(c.node), { id: c.node.item.id, removed: c.removed }]))
    const sdvRef = s.cfg?.sdvField?.referenceName
    const existing = new Map(sdvRef ? s.tests.map((t) => [plainText(t.fields[sdvRef]), t.id] as [string, number]).filter(([k]) => k) : [])
    return planImport(csv.rows, mapping, srsByCode, existing)
  }, [csv, mapping, coverage, s.cfg, s.tests])

  const run = async () => {
    setPhase('running'); setResults({}); setRan(plan)
    await s.importCases(plan, (i, r) => setResults((x) => ({ ...x, [i]: r })))
    setPhase('done')
    toast({ kind: 'success', title: `Imported ${ran.length || plan.length} test cases` })
  }

  const issues = plan.filter((c) => c.issues.length).length
  return (
    <Sheet
      title="Import test cases"
      onClose={onClose}
      size="wide"
      footer={
        phase === 'map' ? (
          <>
            <span className="hint">{plan.filter((c) => !c.existingId).length} new, {plan.filter((c) => c.existingId).length} updated{issues ? ` · ${issues} with SRS problems (those SRS are not linked)` : ''}</span>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setPhase('pick')}>Back</button>
            <button type="button" className="btn primary" disabled={plan.length === 0} onClick={() => void run()}>Import {plan.length} test cases</button>
          </>
        ) : phase === 'done' ? (
          <><span className="grow" /><button type="button" className="btn primary" onClick={onClose}>Done</button></>
        ) : phase === 'running' ? (
          <><span className="hint">Saving to Azure DevOps…</span><span className="grow" /></>
        ) : (
          <><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button></>
        )
      }
    >
      {phase === 'pick' && (
        <div className="empty-state" style={{ padding: '36px 20px' }}>
          <div className="ico"><FileSpreadsheet size={40} strokeWidth={1.2} /></div>
          <h3>Choose the test case sheet</h3>
          <p>Save the Excel sheet as CSV (UTF-8) first. Rows with the same <strong>SDV ID</strong> become one test case; SRS IDs are checked against the project's requirements before anything is created.</p>
          {error && <div className="error-text">{error}</div>}
          <button type="button" className="btn primary lg" onClick={() => void pick()}>Choose file…</button>
        </div>
      )}
      {phase === 'map' && csv && (
        <>
          <div className="map-grid">
            {csv.headers.map((h, i) => (
              <Fragment key={i}>
                <span className="col" title={h}>{h || `Column ${i + 1}`}<span className="faint" style={{ fontWeight: 400, marginLeft: 8, fontSize: 'var(--fs-xs)' }}>{csv.rows[0]?.[i]?.slice(0, 40)}</span></span>
                <span className="arrow">→</span>
                <select className="input" value={targets[i] ?? ''} onChange={(e) => setTargets((m) => m.map((t, j) => (j === i ? e.target.value as Target : t === e.target.value ? '' : t)))}>
                  {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Fragment>
            ))}
          </div>
          {!mapping && <div className="error-text" style={{ marginBottom: 8 }}>Choose which column holds the SDV ID.</div>}
          <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table className="import-table">
              <thead><tr><th>SDV ID</th><th>Title</th><th>SRS</th><th>Steps</th><th>Expected results</th><th>Action</th></tr></thead>
              <tbody>
                {plan.map((c) => (
                  <tr key={c.sdv} className={c.issues.length ? 'warn' : ''}>
                    <td>{c.sdv}</td><td>{c.title}</td>
                    <td>{c.srsIds.length} linked{c.issues.length ? <span className="err"> · {c.issues.join(', ')}</span> : null}</td>
                    <td>{c.steps.length}</td><td>{c.steps.filter((st) => st.kind === 'step' && plain(st.expected).trim()).length}</td>
                    <td>{c.existingId ? `Update #${c.existingId} (steps matched to the existing ones)` : 'Create'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(phase === 'running' || phase === 'done') && (
        <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <table className="import-table">
            <thead><tr><th>SDV ID</th><th>Title</th><th>Result</th></tr></thead>
            <tbody>
              {ran.map((c, i) => {
                const r = results[i]
                return <tr key={c.sdv}><td>{c.sdv}</td><td>{c.title}</td><td className={r?.error ? 'err' : r?.id ? 'ok' : ''}>{r ? (r.error ?? `${c.existingId ? 'Updated' : 'Created'} #${r.id}`) : phase === 'running' ? '…' : ''}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  )
}
