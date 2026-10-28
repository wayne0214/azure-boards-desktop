import { Bot, Download, ExternalLink, FileText, Hand, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from '@/components/ui/Sheet'
import { api } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { parseSteps } from '@/lib/testcases/steps'
import { rowState, stepRows } from '@/lib/testplans/stepResults'
import { BUCKET_LABEL, bucketOf, type ResultAttachment, type TestResultDetail } from '@/lib/testplans/types'
import { useAppStore } from '@/store/useAppStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useTcStore } from '@/store/useTcStore'
import { useUiStore } from '@/store/useUiStore'
import { OutcomePill } from './bits'

const STEPS = 'Microsoft.VSTS.TCM.Steps'
/** Text shown before "Show all", so a large log does not stall the view. */
const TEXT_PREVIEW = 1024 * 1024

const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

export const duration = (ms?: number): string => {
  if (ms == null) return ''
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
}

export const fileSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const decodeText = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

const mimeOf = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : 'image/png'
}

/** An overlay above the sheet; Escape closes it and not the sheet. */
function Overlay({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="tr-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" className="icon-btn tr-overlay-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <div className={`tr-overlay-body ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

/** A screenshot that loads when it scrolls into view. */
function Shot({ file, load, onOpen }: { file: ResultAttachment; load: () => Promise<string>; onOpen: (src: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      load().then((b64) => setSrc(`data:${mimeOf(file.fileName)};base64,${b64}`), (e) => setErr(errorText(e)))
    })
    io.observe(el)
    return () => io.disconnect()
  }, [file, load])
  return (
    <button ref={ref} type="button" className="tr-shot" onClick={() => src && onOpen(src)} disabled={!src} title={src ? 'Enlarge' : undefined}>
      {src ? <img src={src} alt={file.fileName} /> : err ? <span className="faint">{err}</span> : <span className="spinner" />}
    </button>
  )
}

function TextViewer({ file, load, onClose }: { file: ResultAttachment; load: () => Promise<string>; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { load().then((b) => setText(decodeText(b)), (e) => setErr(errorText(e))) }, [load])
  const cut = text != null && !all && text.length > TEXT_PREVIEW
  return (
    <Overlay onClose={onClose} wide>
      <div className="tr-log-head"><FileText size={14} /> <strong>{file.fileName}</strong><span className="faint">{fileSize(file.size)}</span></div>
      {err ? <div className="ts-note danger"><span className="msg">{err}</span></div> : text == null ? <div className="empty-state"><span className="spinner lg" /></div> : (
        <>
          <pre className="tr-log">{cut ? text.slice(0, TEXT_PREVIEW) : text}</pre>
          {cut && <div className="tr-log-more"><span className="faint">Showing the first {fileSize(TEXT_PREVIEW)}.</span> <button type="button" className="btn sm" onClick={() => setAll(true)}>Show all</button></div>}
        </>
      )}
    </Overlay>
  )
}

/** One test result as recorded: outcome, error, step results and attachments. Read-only. */
export function ResultSheet({ project, runId, resultId, onClose }: { project: string; runId: number; resultId: number; onClose: () => void }) {
  const org = useAppStore((s) => s.activeOrg)
  const [detail, setDetail] = useState<TestResultDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ResultAttachment | null>(null)
  const [caseXml, setCaseXml] = useState<string | null>(null)
  const tests = useTcStore((s) => s.tests)
  const shared = useTcStore((s) => s.shared)

  useEffect(() => {
    if (!org) return
    let live = true
    setDetail(null)
    setError(null)
    api().tpResult(org, project, runId, resultId).then((d) => live && setDetail(d), (e) => live && setError(errorText(e)))
    return () => { live = false }
  }, [org, project, runId, resultId])

  // The test case's steps, from Test Cases when it is loaded there.
  const known = detail ? tests.find((t) => t.id === detail.testCaseId) : undefined
  useEffect(() => {
    setCaseXml(null)
    if (!org || !detail?.testCaseId || known) return
    let live = true
    api().getWorkItem(org, project, detail.testCaseId).then((w) => live && setCaseXml(String(w.fields[STEPS] ?? '')), () => live && setCaseXml(''))
    return () => { live = false }
  }, [org, project, detail?.testCaseId, known])
  const xml = known ? String(known.fields[STEPS] ?? '') : caseXml

  const rows = useMemo(() => {
    if (!detail || xml == null) return []
    const sharedById = new Map(shared.map((s) => [s.id, s]))
    return stepRows(parseSteps(xml), detail.steps, (ref) => { const s = sharedById.get(ref); return s ? parseSteps(String(s.fields[STEPS] ?? '')) : undefined })
  }, [detail, xml, shared])

  // One download per attachment, shared by the preview and the viewer; one loader each, so effects do not rerun.
  const loads = useMemo(() => {
    const fns = new Map<number, () => Promise<string>>()
    return (id: number) => {
      let fn = fns.get(id)
      if (!fn) {
        let p: Promise<string> | null = null
        fn = () => {
          if (!org) return Promise.reject(new Error('Not signed in.'))
          if (!p) {
            p = api().tpResultAttachment(org, project, runId, resultId, id)
            p.catch(() => { p = null })
          }
          return p
        }
        fns.set(id, fn)
      }
      return fn
    }
  }, [org, project, runId, resultId])

  const download = async (f: ResultAttachment) => {
    if (!org) return
    const ext = f.fileName.includes('.') ? f.fileName.split('.').pop()! : ''
    const path = await api().pickSavePath(f.fileName, ext ? { name: `.${ext} file`, extensions: [ext] } : { name: 'File', extensions: ['*'] })
    if (!path) return
    try {
      await api().tpSaveResultAttachment(org, project, runId, resultId, f.id, path)
      useUiStore.getState().toast({ kind: 'success', title: `Saved ${f.fileName}` })
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: `Could not save ${f.fileName}`, detail: errorText(e) })
    }
  }

  const images = detail?.attachments.filter((a) => a.kind === 'image') ?? []
  return (
    <Sheet
      title={detail ? `${detail.testCaseTitle || `Test case ${detail.testCaseId}`}` : `Result ${resultId} of run ${runId}`}
      size="wide"
      onClose={onClose}
      headerExtra={detail?.runUrl ? <button type="button" className="btn sm ghost" onClick={() => void api().openUrl(detail.runUrl!)}><ExternalLink size={13} /> Azure DevOps</button> : undefined}
    >
      {error ? <div className="ts-note danger"><span className="msg">{error}</span></div> : !detail ? <div className="empty-state"><span className="spinner lg" /><p>Loading the result…</p></div> : (
        <div className="tr">
          <div className="tr-head">
            <OutcomePill outcome={detail.outcome} />
            {detail.outcome.toLowerCase() !== BUCKET_LABEL[bucketOf(detail.outcome)].toLowerCase() && <span className="tr-raw faint" title="Outcome as recorded">{detail.outcome}</span>}
            <span className="tr-kind">{detail.isAutomated ? <><Bot size={13} /> Automated</> : <><Hand size={13} /> Manual</>}</span>
            <span className="grow" />
            {detail.durationMs != null && <span className="faint">{duration(detail.durationMs)}</span>}
          </div>
          <dl className="tr-facts">
            <dt>Run</dt><dd>#{detail.runId} {detail.runName}</dd>
            <dt>Test case</dt><dd>#{detail.testCaseId}</dd>
            {detail.configuration && <><dt>Configuration</dt><dd>{detail.configuration}</dd></>}
            <dt>Completed</dt><dd>{detail.completedDate ? <span title={new Date(detail.completedDate).toLocaleString()}>{new Date(detail.completedDate).toLocaleString()} · {relativeTime(detail.completedDate)}</span> : '—'}</dd>
            {detail.runBy && <><dt>Run by</dt><dd>{detail.runBy}</dd></>}
            {detail.automatedTestName && <><dt>Automated test</dt><dd className="mono">{detail.automatedTestName}</dd></>}
          </dl>

          {detail.errorMessage && <pre className="tr-error">{detail.errorMessage}</pre>}
          {detail.stackTrace && <details className="tr-stack"><summary>Stack trace</summary><pre>{detail.stackTrace}</pre></details>}
          {detail.comment && <p className="tr-comment">{detail.comment}</p>}

          <div className="tc-label">Steps{detail.iterations > 1 ? <span className="tc-label-note">first of {detail.iterations} iterations</span> : null}</div>
          {!detail.steps.length && rows.length > 0 && <div className="faint tr-no-steps">No step outcomes were recorded with this result{detail.comment ? '; any noted above are in its comment' : ''}.</div>}
          {xml == null ? <div className="faint">Loading the test case…</div> : !rows.length ? <div className="faint">{detail.steps.length ? 'The test case has no steps now.' : 'This result has no step results.'}</div> : (
            <table className="tr-steps">
              <thead><tr><th>#</th><th>Action</th><th>Expected</th><th>Outcome</th><th>Time</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = rowState(r, rows)
                  return (
                    <tr key={r.key} className={`tr-step ${st} ${r.depth ? 'inner' : ''}`}>
                      <td className="tp-id">{r.label ?? r.result?.stepId}</td>
                      {r.kind === 'shared' ? (
                        <td colSpan={2} className="faint">Shared steps #{r.sharedRef}{r.unresolved ? ' · their steps are in that work item' : ''}</td>
                      ) : r.kind === 'extra' ? (
                        <td colSpan={2} className="faint">Step {r.result?.stepId} is not in the test case now</td>
                      ) : (
                        <>
                          <td className="tr-text">{r.action}{r.result?.errorMessage && <div className="tr-step-err">{r.result.errorMessage}</div>}{r.result?.comment && <div className="faint">{r.result.comment}</div>}</td>
                          <td className="tr-text">{r.expected}</td>
                        </>
                      )}
                      <td>{r.result ? <OutcomePill outcome={r.result.outcome} /> : st === 'notRun' ? <span className="faint">Not run</span> : <span className="faint">—</span>}</td>
                      <td className="faint">{duration(r.result?.durationMs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <div className="tc-label">Attachments</div>
          {detail.attachmentsError && <div className="ts-note danger"><span className="msg">Could not list attachments: {detail.attachmentsError}</span></div>}
          {!detail.attachments.length && !detail.attachmentsError && <div className="faint">No attachments.</div>}
          {images.length > 0 && <div className="tr-shots">{images.map((f) => <Shot key={f.id} file={f} load={loads(f.id)} onOpen={setBig} />)}</div>}
          {detail.attachments.length > 0 && (
            <ul className="tr-files">
              {detail.attachments.map((f) => (
                <li key={f.id}>
                  {f.kind === 'image' ? <ImageIcon size={14} /> : f.kind === 'text' ? <FileText size={14} /> : <Paperclip size={14} />}
                  {f.kind === 'text' ? <button type="button" className="link-btn" onClick={() => setViewing(f)}>{f.fileName}</button> : <span>{f.fileName}</span>}
                  <span className="faint">{fileSize(f.size)}</span>
                  {f.comment && <span className="faint tr-file-note">{f.comment}</span>}
                  <span className="grow" />
                  <button type="button" className="icon-btn sm" title={`Download ${f.fileName}`} aria-label={`Download ${f.fileName}`} onClick={() => void download(f)}><Download size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {big && <Overlay onClose={() => setBig(null)}><img className="tr-big" src={big} alt="Screenshot" /></Overlay>}
      {viewing && <TextViewer file={viewing} load={loads(viewing.id)} onClose={() => setViewing(null)} />}
    </Sheet>
  )
}

/** A point's outcome; when it has a recorded last result, clicking opens it. */
export function LastResultPill({ point }: { point: { outcome: string; lastRunId?: number; lastResultId?: number } }) {
  const project = usePlanStore((s) => s.project)
  const [open, setOpen] = useState(false)
  if (!project || point.lastRunId == null || point.lastResultId == null) return <OutcomePill outcome={point.outcome} />
  return (
    <>
      <button type="button" className="tr-pill-btn" title={`Open the result of run ${point.lastRunId}`} onClick={(e) => { e.stopPropagation(); setOpen(true) }} onDoubleClick={(e) => e.stopPropagation()}>
        <OutcomePill outcome={point.outcome} />
      </button>
      {/* The sheet is portalled but React events still bubble to the point's row, which selects or runs the point. */}
      <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {open && <ResultSheet project={project} runId={point.lastRunId} resultId={point.lastResultId} onClose={() => setOpen(false)} />}
      </span>
    </>
  )
}
