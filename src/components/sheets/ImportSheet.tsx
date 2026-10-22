import { FileSpreadsheet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { CsvData, ImportResult, ImportRow } from '@/lib/types'
import { errorMessage } from '@/lib/types'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'

type Target = '' | 'title' | 'type' | 'who' | 'state' | 'iteration' | 'area' | 'priority' | 'points' | 'tags' | 'description' | 'parent'
const targets: { value: Target; label: string }[] = [
  { value: '', label: 'Skip' },
  { value: 'title', label: 'Title (required)' },
  { value: 'type', label: 'Type' },
  { value: 'who', label: 'Assigned to' },
  { value: 'iteration', label: 'Iteration path' },
  { value: 'area', label: 'Area path' },
  { value: 'priority', label: 'Priority' },
  { value: 'points', label: 'Points / Effort' },
  { value: 'tags', label: 'Tags' },
  { value: 'description', label: 'Description' },
  { value: 'parent', label: 'Parent ID' },
]

function guess(header: string): Target {
  const h = header.toLowerCase()
  if (/^title|name|summary/.test(h)) return 'title'
  if (/type/.test(h)) return 'type'
  if (/assign|owner/.test(h)) return 'who'
  if (/iteration|sprint/.test(h)) return 'iteration'
  if (/area/.test(h)) return 'area'
  if (/prior/.test(h)) return 'priority'
  if (/point|effort|estimate|size/.test(h)) return 'points'
  if (/tag|label/.test(h)) return 'tags'
  if (/desc|detail|note/.test(h)) return 'description'
  if (/parent/.test(h)) return 'parent'
  return ''
}

export function ImportSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const toast = useUiStore((s) => s.toast)
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const projectName = useAppStore((s) => s.selectedProject?.name) ?? ''
  const ctx = useBoardStore((s) => s.ctx)
  const refresh = useBoardStore((s) => s.refresh)
  const [csv, setCsv] = useState<CsvData | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [map, setMap] = useState<Target[]>([])
  const [defaultType, setDefaultType] = useState('')
  const [defaultIteration, setDefaultIteration] = useState('')
  const [phase, setPhase] = useState<'pick' | 'map' | 'running' | 'done'>('pick')
  const [results, setResults] = useState<ImportResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const typeNames = useMemo(() => (ctx?.workItemTypes ?? []).filter((t) => !t.isDisabled).map((t) => t.name), [ctx])
  useEffect(() => { if (!defaultType && typeNames.length) setDefaultType(typeNames.includes('Task') ? 'Task' : typeNames[0]) }, [typeNames, defaultType])

  const pick = async () => {
    setError(null)
    const p = await api().pickCsvFile()
    if (!p) return
    try {
      const data = await api().readCsv(p)
      if (data.rows.length === 0) { setError('That file has no rows.'); return }
      setCsv(data); setPath(p); setMap(data.headers.map(guess)); setPhase('map')
    } catch (e) { setError(errorMessage(e)) }
  }

  const titleIdx = map.indexOf('title')
  const rows: ImportRow[] = useMemo(() => {
    if (!csv || titleIdx < 0) return []
    return csv.rows.map((r) => {
      const fields: Record<string, unknown> = {}
      let type = defaultType
      let parent: number | null = null
      r.forEach((cell, i) => {
        const t = map[i]
        const v = cell.trim()
        if (!t || !v) return
        switch (t) {
          case 'title': fields['System.Title'] = v; break
          case 'type': { const m = typeNames.find((x) => x.toLowerCase() === v.toLowerCase()); if (m) type = m; break }
          case 'who': fields['System.AssignedTo'] = v; break
          case 'state': fields['System.State'] = v; break
          case 'iteration': fields['System.IterationPath'] = v.includes('\\') ? v : `${projectName}\\${v}`; break
          case 'area': fields['System.AreaPath'] = v.includes('\\') ? v : `${projectName}\\${v}`; break
          case 'priority': { const n = Number(v.replace(/\D/g, '')); if (n >= 1 && n <= 4) fields['Microsoft.VSTS.Common.Priority'] = n; break }
          case 'points': { const n = Number(v); if (!Number.isNaN(n)) fields[type === 'Task' ? 'Microsoft.VSTS.Scheduling.RemainingWork' : type === 'User Story' ? 'Microsoft.VSTS.Scheduling.StoryPoints' : 'Microsoft.VSTS.Scheduling.Effort'] = n; break }
          case 'tags': fields['System.Tags'] = v.split(/[;,]/).map((x) => x.trim()).filter(Boolean).join('; '); break
          case 'description': fields['System.Description'] = `<p>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`; break
          case 'parent': { const n = Number(v.replace(/\D/g, '')); if (n) parent = n; break }
        }
      })
      if (defaultIteration && !fields['System.IterationPath']) fields['System.IterationPath'] = defaultIteration
      return { work_item_type: type, fields, parent_id: parent }
    }).filter((r) => typeof r.fields['System.Title'] === 'string' && (r.fields['System.Title'] as string).length > 0)
  }, [csv, map, titleIdx, defaultType, defaultIteration, typeNames, projectName])

  const run = async () => {
    setPhase('running'); setResults([])
    const un = api().onImportProgress((r) => setResults((rs) => [...rs, r]))
    try {
      const res = await api().importWorkItems(org, projectName, rows)
      setResults(res)
      const ok = res.filter((r) => r.id).length
      toast({ kind: ok === res.length ? 'success' : 'error', title: `Imported ${ok} of ${res.length} items` })
      void refresh({ silent: true })
    } catch (e) {
      toast({ kind: 'error', title: 'Import failed', detail: errorMessage(e) })
    } finally {
      un(); setPhase('done')
    }
  }

  return (
    <Sheet
      title="Import from CSV"
      onClose={closeSheet}
      size="wide"
      footer={
        phase === 'map' ? (
          <>
            <span className="hint">{rows.length} of {csv?.rows.length ?? 0} rows will be created in {projectName}</span>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setPhase('pick')}>Back</button>
            <button type="button" className="btn primary" disabled={rows.length === 0 || titleIdx < 0 || !projectName} onClick={() => void run()}>Import {rows.length} items</button>
          </>
        ) : phase === 'done' ? (
          <><span className="grow" /><button type="button" className="btn primary" onClick={closeSheet}>Done</button></>
        ) : phase === 'running' ? (
          <><span className="hint">Creating items… you can keep this window open.</span><span className="grow" /></>
        ) : (
          <><span className="grow" /><button type="button" className="btn" onClick={closeSheet}>Cancel</button></>
        )
      }
    >
      {phase === 'pick' && (
        <div className="empty-state" style={{ padding: '36px 20px' }}>
          <div className="ico"><FileSpreadsheet size={40} strokeWidth={1.2} /></div>
          <h3>Choose a CSV file</h3>
          <p>The first row should be column names. You will match columns to fields on the next step, so the file does not need any particular layout. A <strong>Title</strong> column is the only requirement.</p>
          {error && <div className="error-text">{error}</div>}
          <button type="button" className="btn primary lg" onClick={() => void pick()}>Choose file…</button>
          <div className="help">Tip: export from Excel or Google Sheets as CSV (UTF-8).</div>
        </div>
      )}
      {phase === 'map' && csv && (
        <>
          <div className="help" style={{ marginBottom: 6 }}>{path?.split(/[\\/]/).pop()} · {csv.rows.length} rows</div>
          <div className="form-inline" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>Default type</label>
            <select className="input" style={{ width: 180 }} value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>{typeNames.map((t) => <option key={t}>{t}</option>)}</select>
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginLeft: 10 }}>Default iteration</label>
            <select className="input" style={{ width: 220 }} value={defaultIteration} onChange={(e) => setDefaultIteration(e.target.value)}>
              <option value="">Backlog</option>
              {(ctx?.iterations ?? []).filter((i) => i.attributes?.timeFrame !== 'past').map((i) => <option key={i.id} value={i.path}>{i.name}</option>)}
            </select>
          </div>
          <div className="map-grid">
            {csv.headers.map((h, i) => (
              <Fragment key={i}>
                <span className="col" title={h}>{h || `Column ${i + 1}`}<span className="faint" style={{ fontWeight: 400, marginLeft: 8, fontSize: 'var(--fs-xs)' }}>{csv.rows[0]?.[i]?.slice(0, 40)}</span></span>
                <span className="arrow">→</span>
                <select className="input" value={map[i] ?? ''} onChange={(e) => setMap((m) => { const n = m.slice(); n[i] = e.target.value as Target; return n })}>
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Fragment>
            ))}
          </div>
          {titleIdx < 0 && <div className="error-text" style={{ marginBottom: 8 }}>Choose which column holds the title.</div>}
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table className="import-table">
              <thead><tr><th>#</th><th>Type</th><th>Title</th><th>Assigned to</th><th>Iteration</th><th>Tags</th></tr></thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}><td className="faint">{i + 1}</td><td>{r.work_item_type}</td><td>{String(r.fields['System.Title'])}</td><td>{String(r.fields['System.AssignedTo'] ?? '')}</td><td>{String(r.fields['System.IterationPath'] ?? '').split('\\').pop()}</td><td>{String(r.fields['System.Tags'] ?? '')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(phase === 'running' || phase === 'done') && (
        <>
          <div className="progress" style={{ margin: '6px 0 12px' }}><i style={{ width: `${(results.length / Math.max(1, rows.length)) * 100}%` }} /></div>
          <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table className="import-table">
              <thead><tr><th>#</th><th>Title</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = results.find((x) => x.index === i)
                  return (
                    <tr key={i}><td className="faint">{i + 1}</td><td>{String(r.fields['System.Title'])}</td>
                      <td className={res?.error ? 'err' : res?.id ? 'ok' : ''}>{res ? (res.error ?? `Created #${res.id}`) : phase === 'running' ? '…' : ''}</td></tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  )
}

import { Fragment } from 'react'
