import { Bot, Hand, History, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { OutcomePill } from '@/components/plans/bits'
import { ResultSheet } from '@/components/plans/ResultSheet'
import { Sheet } from '@/components/ui/Sheet'
import { api } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import type { TestResultSummary } from '@/lib/testplans/types'
import { useAppStore } from '@/store/useAppStore'

const LIMIT = 50
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

/** A test case's recorded results in Azure Test Plans, newest first. Clicking one opens it. Read-only. */
function RunsList({ testCaseId, project }: { testCaseId: number; project: string }) {
  const org = useAppStore((a) => a.activeOrg)
  const [list, setList] = useState<TestResultSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [shown, setShown] = useState<{ runId: number; resultId: number } | null>(null)
  const [tick, setTick] = useState(0)
  const reload = () => { setList(null); setTick((t) => t + 1) }

  const load = useCallback(() => {
    if (!org) return () => {}
    let live = true
    setLoading(true)
    setError(null)
    api().tpListResults(org, project, { testCaseId, limit: LIMIT })
      .then((l) => live && setList(l), (e) => live && setError(errorText(e)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [org, project, testCaseId])

  useEffect(() => { setList(null); setShown(null) }, [testCaseId])
  useEffect(() => (list == null ? load() : undefined), [list, load, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="tc-runs-bar">
        {list && <span className="faint">{list.length >= LIMIT ? `Latest ${LIMIT} results` : `${list.length} result${list.length === 1 ? '' : 's'} recorded`}</span>}
        <span className="grow" />
        <button type="button" className="icon-btn sm" title="Reload" aria-label="Reload runs" disabled={loading} onClick={reload}><RefreshCw size={13} /></button>
      </div>
      {error ? <div className="ts-note danger"><span className="msg">{error}</span><button type="button" className="btn sm primary" onClick={reload}>Try again</button></div>
        : list == null ? <div className="faint tc-runs-empty"><span className="spinner" /> Loading results…</div>
        : !list.length ? <div className="faint tc-runs-empty">No results are recorded for this test case in Azure Test Plans.</div>
        : (
          <div className="tc-runs-scroll"><table className="tc-runs-table">
            <thead><tr><th>Run</th><th>Date</th><th>Outcome</th><th>Configuration</th><th>How</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.runId}-${r.resultId}`} className="tp-click" onClick={() => setShown({ runId: r.runId, resultId: r.resultId })} title={r.errorMessage}>
                  <td><span className="tp-id">#{r.runId}</span> {r.runName}</td>
                  <td className="muted" title={r.completedDate ? new Date(r.completedDate).toLocaleString() : undefined}>{r.completedDate ? relativeTime(r.completedDate) : '—'}</td>
                  <td><OutcomePill outcome={r.outcome} /></td>
                  <td>{r.configuration ?? '—'}</td>
                  <td className="muted">{r.isAutomated ? <><Bot size={13} /> Automated</> : <><Hand size={13} /> Manual</>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      {shown && <ResultSheet project={project} runId={shown.runId} resultId={shown.resultId} onClose={() => setShown(null)} />}
    </>
  )
}

/** Opens a test case's run history: every result recorded in Azure Test Plans. */
export function HistoryButton({ testCaseId, title }: { testCaseId: number; title: string }) {
  const project = useAppStore((a) => a.selectedProject?.name)
  const [open, setOpen] = useState(false)
  if (!project) return null
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)} title="Every recorded result of this test case in Azure Test Plans: steps, errors, screenshots and logs"><History size={13} /> History</button>
      {open && <RunHistorySheet testCaseId={testCaseId} title={title} project={project} onClose={() => setOpen(false)} />}
    </>
  )
}

/** A test case's full run history in a sheet, e.g. from the Test Plans runner. */
export function RunHistorySheet({ testCaseId, title, project, onClose }: { testCaseId: number; title: string; project: string; onClose: () => void }) {
  return (
    <Sheet title={`Runs of ${title || `test case ${testCaseId}`}`} size="wide" onClose={onClose}>
      <RunsList testCaseId={testCaseId} project={project} />
    </Sheet>
  )
}
