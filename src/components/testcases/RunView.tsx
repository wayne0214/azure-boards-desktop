import DOMPurify from 'dompurify'
import { useShallow } from 'zustand/react/shallow'
import { Bug, Check, ChevronRight, ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Empty } from '@/components/ui/Empty'
import { imageFiles } from '@/lib/attachments'
import { fieldText, idOf, plainText, type ReqConfig, type ReqTree } from '@/lib/requirements'
import type { TcConfig } from '@/lib/testcases/config'
import { srsLinks, type Coverage } from '@/lib/testcases/coverage'
import { flatSteps } from '@/lib/testcases/document'
import { canPass, expectedChecklist, type Outcome, type RunRecord } from '@/lib/testcases/run'
import { plain } from '@/lib/testcases/steps'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useTcStore } from '@/store/useTcStore'
import { useUiStore } from '@/store/useUiStore'

const MAX_IMAGE = 25 * 1024 * 1024
type Scope = 'all' | 'notrun' | 'failed' | `di:${number}` | `srs:${number}`
const sanitize = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
const sdvOf = (cfg: TcConfig, t: WorkItem) => (cfg.sdvField ? plainText(t.fields[cfg.sdvField.referenceName]) : '') || `#${t.id}`
const today = () => new Date().toISOString().slice(0, 10)

/** Run mode: go through test cases for a release, judging each step against its expected result. */
export function RunView({ cfg, reqCfg, tree, coverage }: { cfg: TcConfig; reqCfg: ReqConfig; tree: ReqTree; coverage: Coverage }) {
  const s = useTcStore(useShallow((st) => ({ releases: st.releases, runsFor: st.runsFor, shared: st.shared, tests: st.tests })))
  const [release, setRelease] = useState(() => s.releases[0] ?? '')
  const [scope, setScope] = useState<Scope>('all')
  const [runs, setRuns] = useState<Map<number, RunRecord>>(new Map())
  const [currentId, setCurrentId] = useState<number | null>(null)
  const sharedById = useMemo(() => new Map(s.shared.map((w) => [w.id, w])), [s.shared])

  // Every test case, in SDV order.
  const all = useMemo(() => [...s.tests].sort((a, b) => sdvOf(cfg, a).localeCompare(sdvOf(cfg, b), undefined, { numeric: true })), [s.tests, cfg])
  useEffect(() => {
    if (!release.trim()) { setRuns(new Map()); return }
    let live = true
    void s.runsFor(all.map((t) => t.id), release.trim()).then((m) => { if (live) setRuns(m) })
    return () => { live = false }
  }, [release, all]) // eslint-disable-line react-hooks/exhaustive-deps

  const queue = useMemo(() => all.filter((t) => {
    if (scope === 'notrun') return !runs.has(t.id)
    if (scope === 'failed') return runs.get(t.id)?.outcome === 'fail'
    if (scope.startsWith('srs:')) return srsLinks(t).includes(Number(scope.slice(4)))
    if (scope.startsWith('di:')) { const di = tree.byId.get(Number(scope.slice(3))); return !!di && srsLinks(t).some((id) => di.children.some((c) => c.item.id === id)) }
    return true
  }), [all, scope, runs, tree])

  const current = queue.find((t) => t.id === currentId) ?? queue[0] ?? null
  const done = queue.filter((t) => runs.has(t.id)).length
  const next = () => { const i = queue.findIndex((t) => t.id === current?.id); setCurrentId(queue[i + 1]?.id ?? null) }
  const allDis = [...tree.roots.flatMap((u) => u.children), ...tree.orphanDis]

  return (
    <>
      <div className="req-bar">
        <label className="faint tc-run-label">Release</label>
        <input className="input" style={{ width: 200 }} list="tc-releases" value={release} placeholder="e.g. v2.1.0 RC1" onChange={(e) => setRelease(e.target.value)} />
        <datalist id="tc-releases">{s.releases.map((r) => <option key={r} value={r} />)}</datalist>
        <select className="input" style={{ width: 240 }} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
          <option value="all">All test cases</option>
          <option value="notrun">Not run in this release</option>
          <option value="failed">Failed in this release</option>
          {allDis.map((d) => <option key={d.item.id} value={`di:${d.item.id}`}>{idOf(d)} · {String(d.item.fields['System.Title'] ?? '')}</option>)}
          {[...coverage.bySrs.values()].filter((c) => c.tests.length).map((c) => <option key={c.node.item.id} value={`srs:${c.node.item.id}`}>{idOf(c.node)} · {String(c.node.item.fields['System.Title'] ?? '')}</option>)}
        </select>
        <span className="grow" />
        {release.trim() && <span className="faint">{done} of {queue.length} run in {release.trim()}</span>}
      </div>
      <div className="tc-split">
        <aside className="tc-tree tc-run-queue">
          {queue.length === 0 && <div className="faint tc-run-empty">Nothing to run in this view.</div>}
          {queue.map((t) => {
            const r = runs.get(t.id)
            return (
              <button key={t.id} type="button" className={`tc-run-item ${current?.id === t.id ? 'sel' : ''}`} onClick={() => setCurrentId(t.id)}>
                <i className={`tc-dot ${r ? (r.outcome === 'pass' ? 'pass' : 'fail') : 'none'}`} />
                <span className="req-id">{sdvOf(cfg, t)}</span>
                <span className="req-name">{String(t.fields['System.Title'] ?? '')}</span>
              </button>
            )
          })}
        </aside>
        <section className="tc-editor">
          {!release.trim()
            ? <Empty title="Which release is this?">Type the release or build you are testing, then work through the list.</Empty>
            : current
              ? <RunCase key={`${current.id}-${release}`} cfg={cfg} reqCfg={reqCfg} tree={tree} test={current} release={release.trim()} last={runs.get(current.id)} shared={sharedById}
                  onRecorded={(r) => setRuns((m) => new Map(m).set(current.id, r))} onNext={next} />
              : <Empty title="All done">Every test case in this view has been run.</Empty>}
        </section>
      </div>
    </>
  )
}

function RunCase({ cfg, reqCfg, tree, test, release, last, shared, onRecorded, onNext }: {
  cfg: TcConfig; reqCfg: ReqConfig; tree: ReqTree; test: WorkItem; release: string; last?: RunRecord; shared: Map<number, WorkItem>
  onRecorded: (r: RunRecord) => void; onNext: () => void
}) {
  const s = useTcStore(useShallow((st) => ({ createBug: st.createBug, recordRun: st.recordRun })))
  const me = useAppStore((a) => a.account())
  const toast = useUiStore((u) => u.toast)
  const steps = flatSteps(test, shared)
  const [stepOut, setStepOut] = useState<(Outcome | null)[]>(() => steps.map(() => null))
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<RunRecord | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  const linked = srsLinks(test).map((id) => tree.byId.get(id)).filter((n) => !!n)
  const addFiles = (list: File[]) => {
    const ok = list.filter((f) => f.type.startsWith('image/') && f.size <= MAX_IMAGE)
    if (ok.length < list.length) toast({ kind: 'error', title: 'Some files were skipped', detail: 'Only images up to 25 MB can be attached.' })
    setFiles((x) => [...x, ...ok])
  }
  // The expected results are the acceptance criteria: each must be marked as met to pass.
  const checklist = expectedChecklist(steps)
  const criteria = checklist.map((c) => ({ text: `${c.n}. ${c.text}`, met: stepOut[c.n - 1] === 'pass' }))
  const passable = canPass(criteria) && !stepOut.includes('fail')
  const failing = stepOut.includes('fail')

  const record = async (outcome: Outcome) => {
    if (outcome === 'fail' && !failing) { toast({ kind: 'error', title: 'Mark what failed', detail: 'Mark the step that failed first.' }); return }
    setSaving(true)
    try {
      const r: Omit<RunRecord, 'images'> = {
        outcome, release, date: today(), by: me?.userName ?? 'Unknown',
        criteria, steps: stepOut.map((o, i) => ({ index: i + 1, outcome: o })).filter((x) => x.outcome), note,
      }
      const res = await s.recordRun(test.id, r, files)
      const saved: RunRecord = { ...r, images: files.map((f) => ({ url: '', caption: f.name })) }
      onRecorded(saved)
      toast({ kind: 'success', title: outcome === 'pass' ? 'Passed' : 'Failed', detail: res.note ?? (res.mirrored ? 'Also saved to Test Plans.' : undefined) })
      if (outcome === 'fail') setFailed(saved)
      else onNext()
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the run', detail: String((e as Error)?.message ?? e) })
    } finally {
      setSaving(false)
    }
  }

  const fileBug = async () => {
    const badStep = stepOut.findIndex((o) => o === 'fail')
    const badCrit = criteria.filter((c) => !c.met).map((c) => c.text)
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const repro = [
      `<p><b>Found while running ${esc(sdvOf(cfg, test))} ${esc(String(test.fields['System.Title'] ?? ''))}</b> in release ${esc(release)}.</p>`,
      `<ol>${steps.slice(0, badStep >= 0 ? badStep + 1 : steps.length).map((st) => `<li>${plain(st.action)}</li>`).join('')}</ol>`,
      badStep >= 0 ? `<p>Expected at step ${badStep + 1}: ${esc(plain(steps[badStep].expected))}</p>` : '',
      badCrit.length ? `<p>Not met:</p><ul>${badCrit.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '',
      note ? `<p>${esc(note)}</p>` : '',
    ].join('')
    await s.createBug(test.id, { title: `${sdvOf(cfg, test)} failed: ${badCrit[0] ?? (badStep >= 0 ? `step ${badStep + 1}` : String(test.fields['System.Title'] ?? ''))}`, repro, srsId: srsLinks(test)[0] ?? null })
  }

  return (
    <div className="tc-ed tc-run" onPaste={(e: ClipboardEvent) => { const f = imageFiles(e.clipboardData); if (f.length) { e.preventDefault(); addFiles(f) } }}>
      <div className="tc-ed-top"><span className="tc-sdv tc-sdv-ro">{sdvOf(cfg, test)}</span><strong className="tc-title">{String(test.fields['System.Title'] ?? '')}</strong></div>
      {last && <div className="faint tc-run-last">Last run in {release}: <b className={last.outcome}>{last.outcome === 'pass' ? 'Passed' : 'Failed'}</b> on {last.date} by {last.by}</div>}

      {linked.length > 0 && reqCfg.acceptanceField && (
        <details className="tc-ref">
          <summary>SRS acceptance criteria for reference</summary>
          {linked.map((n) => (
            <div key={n.item.id}><b>{idOf(n)}</b><div dangerouslySetInnerHTML={{ __html: sanitize(fieldText(n.item, reqCfg.acceptanceField!.referenceName)) }} /></div>
          ))}
        </details>
      )}

      <div className="tc-label">Steps <span className="tc-label-note">mark each expected result as met or not</span></div>
      {checklist.length === 0 && <div className="faint tc-none">No step has an expected result, so this test case cannot pass. Add expected results in Outline.</div>}
      <div className="tc-steps">
        <div className="tc-steps-head tc-run-steps"><span>#</span><span>Action</span><span>Expected result</span><span /></div>
        {steps.map((st, i) => (
          <div key={i} className="tc-step tc-run-steps">
            <span className="tc-step-n">{i + 1}</span>
            <div className="tc-cell ro" dangerouslySetInnerHTML={{ __html: sanitize(st.action + (st.from ? ` <em>(${st.from})</em>` : '')) }} />
            <div className="tc-cell ro" dangerouslySetInnerHTML={{ __html: sanitize(st.expected) }} />
            <span className="tc-step-judge">
              <button type="button" className={`tc-tick ${stepOut[i] === 'pass' ? 'on' : ''}`} title={plain(st.expected).trim() ? 'Met' : 'Step done'} onClick={() => setStepOut((o) => o.map((x, j) => (j === i ? (x === 'pass' ? null : 'pass') : x)))}><Check size={12} /></button>
              <button type="button" className={`tc-tick no ${stepOut[i] === 'fail' ? 'on' : ''}`} title={plain(st.expected).trim() ? 'Not met' : 'Step failed'} onClick={() => setStepOut((o) => o.map((x, j) => (j === i ? (x === 'fail' ? null : 'fail') : x)))}><X size={12} /></button>
            </span>
          </div>
        ))}
        {steps.length === 0 && <div className="faint tc-none" style={{ padding: 10 }}>No steps.</div>}
      </div>

      <div className="tc-label">Evidence</div>
      <div className="tc-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e: DragEvent) => { e.preventDefault(); addFiles(imageFiles(e.dataTransfer)) }}>
        {files.map((f, i) => (
          <div key={i} className="tc-thumb">
            <img src={URL.createObjectURL(f)} alt={f.name} />
            <button type="button" className="icon-btn sm" title="Remove" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="tc-drop-add" onClick={() => pick.current?.click()}><ImagePlus size={16} /> Paste, drop or choose screenshots</button>
        <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>

      <div className="tc-label">Note</div>
      <textarea className="input tc-run-note" value={note} placeholder="Anything worth knowing about this run" onChange={(e) => setNote(e.target.value)} />

      <div className="tc-run-actions">
        {failed ? (
          <>
            <span className="faint">Recorded as failed.</span>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => void fileBug()}><Bug size={14} /> Create bug</button>
            <button type="button" className="btn primary" onClick={onNext}>Next <ChevronRight size={14} /></button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onNext}>Skip</button>
            <span className="grow" />
            <button type="button" className="btn danger" disabled={saving} onClick={() => void record('fail')}><X size={14} /> Fail</button>
            <button type="button" className="btn primary" disabled={saving || !passable} title={passable ? undefined : 'Every expected result must be marked as met'} onClick={() => void record('pass')}><Check size={14} /> Pass</button>
          </>
        )}
      </div>
    </div>
  )
}
