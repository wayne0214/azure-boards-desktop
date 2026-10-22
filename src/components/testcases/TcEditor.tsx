import DOMPurify from 'dompurify'
import { useShallow } from 'zustand/react/shallow'
import { AlertTriangle, ExternalLink, Link2, Unlink, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RichText } from '@/components/inspector/RichText'
import { Sheet } from '@/components/ui/Sheet'
import { hydrateImages } from '@/lib/attachments'
import { stateColor } from '@/lib/format'
import { fieldText, idOf, plainText, type ReqNode, type ReqTree } from '@/lib/requirements'
import { STEPS, type TcConfig } from '@/lib/testcases/config'
import { srsLinks } from '@/lib/testcases/coverage'
import { paramNames, parseTestData, serializeTestData, type TestData } from '@/lib/testcases/params'
import type { SpecChange } from '@/lib/testcases/review'
import { sdvClash } from '@/lib/testcases/sdv'
import { parseSteps } from '@/lib/testcases/steps'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useReqStore } from '@/store/useReqStore'
import { useTcStore } from '@/store/useTcStore'
import { SrsPicker } from './SrsPicker'
import { StepGrid } from './StepGrid'

const SAVE_DELAY = 800

/** A text field that saves itself a moment after typing stops, and on leaving the field. */
function useAutosave(saved: string, save: (v: string) => void): [string, (v: string) => void, () => void] {
  const [value, setValue] = useState(saved)
  const timer = useRef<number | null>(null)
  const pending = useRef<string | null>(null)
  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (pending.current !== null && pending.current !== saved) save(pending.current)
    pending.current = null
  }
  useEffect(() => { if (pending.current === null) setValue(saved) }, [saved])
  useEffect(() => () => flush(), []) // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => {
    setValue(v)
    pending.current = v
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY)
  }
  return [value, change, flush]
}

/** The selected test case: what it verifies, its preconditions and steps (whose expected results are its acceptance criteria). */
export function TcEditor({ cfg, test, tree }: { cfg: TcConfig; test: WorkItem; tree: ReqTree }) {
  const s = useTcStore(useShallow((st) => ({ clearFresh: st.clearFresh, createShared: st.createShared, fresh: st.fresh, linkSrs: st.linkSrs, markReviewed: st.markReviewed, retrySave: st.retrySave, reviewNeeded: st.reviewNeeded, save: st.save, saveState: st.saveState, shared: st.shared, tests: st.tests, unlinkSrs: st.unlinkSrs })))
  const types = useBoardStore((b) => b.ctx?.workItemTypes ?? [])
  const project = useAppStore((a) => a.selectedProject)
  const [picking, setPicking] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const save = (fields: Record<string, unknown>) => void s.save(test.id, fields)

  const sdvRef = cfg.sdvField?.referenceName
  const [sdv, setSdv, flushSdv] = useAutosave(sdvRef ? plainText(test.fields[sdvRef]) : '', (v) => sdvRef && save({ [sdvRef]: v.trim() }))
  const [title, setTitle, flushTitle] = useAutosave(String(test.fields['System.Title'] ?? ''), (v) => v.trim() && save({ 'System.Title': v.trim() }))

  useEffect(() => {
    if (s.fresh !== test.id) return
    titleRef.current?.focus()
    titleRef.current?.select()
    s.clearFresh()
  }, [s.fresh, test.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clash = useMemo(() => {
    if (!sdvRef) return null
    const others = s.tests.filter((t) => t.id !== test.id).map((t) => ({ id: t.id, sdv: plainText(t.fields[sdvRef]) }))
    return sdvClash(others, sdv)
  }, [s.tests, sdvRef, sdv, test.id])

  const linked = srsLinks(test).map((id) => ({ id, node: tree.byId.get(id) }))
  const state = String(test.fields['System.State'] ?? '')
  const assigned = (test.fields['System.AssignedTo'] as { displayName?: string } | undefined)?.displayName
  const saveState = s.saveState[test.id]
  const usage = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of s.tests) for (const ref of new Set(parseSteps(t.fields[STEPS] as string | undefined).flatMap((it) => (it.kind === 'shared' ? [it.ref] : [])))) m.set(ref, (m.get(ref) ?? 0) + 1)
    return m
  }, [s.tests])

  return (
    <div className="tc-ed">
      <div className="tc-ed-top">
        {sdvRef && (
          <input className="tc-sdv" value={sdv} placeholder="SDV ID" title={cfg.sdvField!.name} onChange={(e) => setSdv(e.target.value)} onBlur={flushSdv} />
        )}
        <input ref={titleRef} className="tc-title" value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} onBlur={flushTitle} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </div>
      {clash && (
        <div className="tc-warn">
          <AlertTriangle size={14} />
          <span>{sdv.trim()} is already used by #{clash.id}. Use {clash.next}?</span>
          <button type="button" className="btn sm" onClick={() => { setSdv(clash.next); if (sdvRef) save({ [sdvRef]: clash.next }) }}>Use {clash.next}</button>
        </div>
      )}
      <div className="tc-meta">
        <span>#{test.id}</span>
        <span className="req-state"><i style={{ background: stateColor(types, cfg.type.name, state) }} />{state}</span>
        {test.fields['Microsoft.VSTS.Common.Priority'] != null && <span>Priority {String(test.fields['Microsoft.VSTS.Common.Priority'])}</span>}
        <span>{assigned ?? 'Unassigned'}</span>
        <span className={`tc-saved ${saveState ?? ''}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Not saved' : saveState === 'saved' ? 'Saved to Azure DevOps' : ''}</span>
        {saveState === 'failed' && <button type="button" className="btn sm" onClick={() => void s.retrySave(test.id)}>Retry</button>}
        <button type="button" className="icon-btn sm" title="Open details" onClick={() => void useBoardStore.getState().openItem(test)}><ExternalLink size={14} /></button>
      </div>

      <div className="tc-label">Verifies</div>
      {linked.length === 0 && <div className="faint tc-none">Not linked to any SRS yet.</div>}
      {linked.map(({ id, node }) => (
        <SrsCard key={id} id={id} node={node} tree={tree} onUnlink={() => void s.unlinkSrs(test.id, id)}
          change={s.reviewNeeded.get(test.id)?.find((r) => r.srsId === id)?.change} onReviewed={() => void s.markReviewed(test.id, id)} />
      ))}
      <div className="tc-link-wrap">
        {picking
          ? <SrsPicker tree={tree} exclude={linked.map((l) => l.id)} onPick={(id) => void s.linkSrs(test.id, id)} onClose={() => setPicking(false)} />
          : <button type="button" className="tc-link-add" onClick={() => setPicking(true)}><Link2 size={14} /> Link another SRS</button>}
      </div>

      <div className="tc-label">Preconditions</div>
      <RichText
        key={`${test.id}-pre`}
        html={String(test.fields[cfg.preconditionsField.referenceName] ?? '')}
        placeholder="What must be set up before the first step"
        project={project?.name}
        onSave={(html) => save({ [cfg.preconditionsField.referenceName]: html })}
      />

      <div className="tc-label">Steps</div>
      <StepGrid key={`${test.id}-steps`} value={String(test.fields[STEPS] ?? '')} shared={s.shared} usage={usage} onChange={(xml) => save({ [STEPS]: xml })} onMakeShared={cfg.sharedStepsType ? s.createShared : undefined} />
      <TestDataTable test={test} onSave={save} />
    </div>
  )
}

/** One linked SRS with its current specification and acceptance criteria, read-only. */
function SrsCard({ id, node, tree, onUnlink, change, onReviewed }: { id: number; node: ReqNode | undefined; tree: ReqTree; onUnlink: () => void; change?: SpecChange; onReviewed: () => void }) {
  const [showChange, setShowChange] = useState(false)
  const reqCfg = useReqStore((r) => r.cfg)
  const org = useAppStore((a) => a.activeOrg)
  const ref = useRef<HTMLDivElement>(null)
  const spec = node ? fieldText(node.item, node.tier.textField?.referenceName) : ''
  const ac = node && reqCfg?.acceptanceField ? fieldText(node.item, reqCfg.acceptanceField.referenceName) : ''

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = DOMPurify.sanitize(`${spec}${ac ? `<p class="tc-ac-head">Acceptance criteria</p>${ac}` : ''}`, { USE_PROFILES: { html: true } })
    if (org) hydrateImages(ref.current, org)
  }, [spec, ac, org])

  if (!node) {
    return (
      <div className="tc-srs missing">
        <div className="tc-srs-head"><span className="req-id">#{id}</span><span className="faint">This requirement is removed or not in this project.</span><span className="grow" /><button type="button" className="btn sm" onClick={onUnlink}><Unlink size={13} /> Unlink</button></div>
      </div>
    )
  }
  const parent = (n: ReqNode) => { const p = n.item.fields['System.Parent']; return typeof p === 'number' ? tree.byId.get(p) : undefined }
  const di = parent(node)
  const un = di ? parent(di) : undefined
  return (
    <div className={`tc-srs ${change ? 'suspect' : ''}`}>
      <div className="tc-srs-head">
        <span className="req-id">{idOf(node) || `#${id}`}</span>
        <span className="req-name">{String(node.item.fields['System.Title'] ?? '')}</span>
        <span className="grow" />
        <span className="faint">{[di && idOf(di), un && idOf(un)].filter(Boolean).join(' · ')}</span>
        <button type="button" className="btn sm" onClick={() => void useBoardStore.getState().openItem(node.item)}>Open</button>
        <button type="button" className="icon-btn sm" title="Unlink" onClick={onUnlink}><Unlink size={13} /></button>
      </div>
      <div className="tc-srs-text" ref={ref} />
      {change && (
        <div className="tc-warn tc-suspect">
          <AlertTriangle size={14} />
          <span>{idOf(node) || `#${id}`} changed on {new Date(change.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ({fieldName(change.field)}{change.by ? `, by ${change.by}` : ''}), after this test case was last reviewed.</span>
          <span className="grow" />
          <button type="button" className="btn sm" onClick={() => setShowChange(true)}>See change</button>
          <button type="button" className="btn sm primary" onClick={onReviewed}>Mark reviewed</button>
        </div>
      )}
      {change && showChange && (
        <Sheet title={`${idOf(node) || `#${id}`}: what changed`} onClose={() => setShowChange(false)} size="wide">
          <div className="tc-diff">
            <div><div className="tc-label">Before</div><div className="tc-diff-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(change.oldValue || '<p><em>Empty</em></p>') }} /></div>
            <div><div className="tc-label">After</div><div className="tc-diff-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(change.newValue || '<p><em>Empty</em></p>') }} /></div>
          </div>
        </Sheet>
      )}
    </div>
  )

  function fieldName(ref: string) {
    if (ref === reqCfg?.acceptanceField?.referenceName) return reqCfg.acceptanceField.name
    return node?.tier.textField?.name ?? ref
  }
}

const PARAMS = 'Microsoft.VSTS.TCM.Parameters'
const DATA = 'Microsoft.VSTS.TCM.LocalDataSource'

/** Values for the steps' @parameters: one column each, one row per run of the steps. */
function TestDataTable({ test, onSave }: { test: WorkItem; onSave: (fields: Record<string, unknown>) => void }) {
  const used = paramNames(parseSteps(test.fields[STEPS] as string | undefined))
  const saved = parseTestData(test.fields[PARAMS] as string | undefined, test.fields[DATA] as string | undefined)
  const [data, setData] = useState<TestData>(saved)
  useEffect(() => { setData(parseTestData(test.fields[PARAMS] as string | undefined, test.fields[DATA] as string | undefined)) }, [test.fields[PARAMS], test.fields[DATA]]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new @name in the steps adds its column; a column no step uses any more stays until removed.
  const names = [...used, ...data.names.filter((n) => !used.includes(n))]
  const unused = data.names.filter((n) => !used.includes(n))
  if (names.length === 0) return null
  const commit = (next: TestData) => { setData(next); const x = serializeTestData(next); onSave({ [PARAMS]: x.params, [DATA]: x.dataSource }) }
  const rows = data.rows.length ? data.rows : [{}]

  return (
    <>
      <div className="tc-label">Test data <span className="tc-label-note">the steps run once per row</span></div>
      <div className="tc-data">
        <table>
          <thead><tr>{names.map((n) => <th key={n} className={unused.includes(n) ? 'unused' : ''}>@{n}{unused.includes(n) && <button type="button" className="icon-btn sm" title={`No step uses @${n} any more. Remove the column`} onClick={() => commit({ names: data.names.filter((x) => x !== n), rows: data.rows.map(({ [n]: _gone, ...r }) => r) })}><X size={11} /></button>}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {names.map((n) => (
                  <td key={n}><input value={r[n] ?? ''} onChange={(e) => setData({ names, rows: rows.map((x, j) => (j === i ? { ...x, [n]: e.target.value } : x)) })} onBlur={() => commit({ names, rows: data.rows.length ? data.rows : rows })} /></td>
                ))}
                <td><button type="button" className="icon-btn sm" title="Remove row" onClick={() => commit({ names, rows: rows.filter((_, j) => j !== i) })}><X size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="tc-step-add" onClick={() => commit({ names, rows: [...rows, {}] })}>+ Add row</button>
      </div>
    </>
  )
}
