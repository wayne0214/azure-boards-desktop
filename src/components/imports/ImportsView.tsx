import { AlertTriangle, ChevronDown, ExternalLink, FileInput, Pencil, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import { itemUrl, relativeTime } from '@/lib/format'
import type { FieldChange, ImportInfo, ImportPick, ImportResult, ImportReview, ReviewRow, RowCategory } from '@/lib/mcp'
import { useUiStore } from '@/store/useUiStore'
import { importCalls, useImportStore } from './useImportStore'

const CATEGORY: Record<RowCategory, { label: string; tab: string; chip: string }> = {
  new: { label: 'New', tab: 'New', chip: 'ok' },
  changed: { label: 'Changed', tab: 'Changed', chip: '' },
  conflict: { label: 'Conflict', tab: 'Conflicts', chip: 'warn' },
  missing: { label: 'Only in Boards', tab: 'Only in Boards', chip: 'bad' },
  error: { label: 'Error', tab: 'Errors', chip: 'bad' },
  same: { label: 'Unchanged', tab: 'Unchanged', chip: '' },
}
const TABS: (RowCategory | 'all')[] = ['all', 'new', 'changed', 'conflict', 'missing', 'error', 'same']
/** What can be picked, and what is picked to begin with. */
const PICKABLE: RowCategory[] = ['new', 'changed', 'conflict', 'missing']
const PICKED_FIRST: RowCategory[] = ['new', 'changed']

const STATUS: Record<ImportInfo['status'], string> = { pending: 'To review', applying: 'Applying…', applied: 'Applied', discarded: 'Discarded', superseded: 'Replaced' }

const when = (ms: number) => relativeTime(new Date(ms).toISOString())
const sourceName = (i: ImportInfo) => i.source ?? 'Import'

/** Imports staged by Claude Code or Codex (MCP `stage_import`), reviewed and applied here. */
export function ImportsView() {
  const list = useImportStore((s) => s.list)
  const selectedId = useImportStore((s) => s.selectedId)
  const select = useImportStore((s) => s.select)
  const load = useImportStore((s) => s.load)
  const [loading, setLoading] = useState(false)
  const refresh = async () => { setLoading(true); await load(); setLoading(false) }
  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = list.find((i) => i.id === selectedId) ?? null
  const open = (i: ImportInfo) => i.status === 'pending' || i.status === 'applying'
  const pending = list.filter(open)
  const done = list.filter((i) => !open(i))

  return (
    <div className="pr imp">
      <aside className="pr-list">
        <div className="pr-list-head imp-list-head">
          <span className="imp-list-title">Imports</span>
          <button type="button" className="icon-btn" title="Refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
        </div>
        <div className="pr-list-body">
          {list.length === 0 && !loading && <div className="empty-state" style={{ padding: 24 }}><h3 style={{ fontSize: 'var(--fs-md)' }}>Nothing staged</h3></div>}
          {pending.length > 0 && <div className="pr-group">To review <span className="faint">· {pending.length}</span></div>}
          {pending.map((i) => <ImportRow key={i.id} info={i} selected={i.id === selectedId} onOpen={() => select(i.id)} />)}
          {done.length > 0 && <div className="pr-group">History</div>}
          {done.map((i) => <ImportRow key={i.id} info={i} selected={i.id === selectedId} onOpen={() => select(i.id)} />)}
        </div>
      </aside>
      <section className="pr-detail">
        {selected ? (
          selected.status === 'pending' ? <ReviewPane key={selected.id} info={selected} /> : <ResultPane key={selected.id} info={selected} onOpen={select} newer={list.find((i) => i.status === 'pending' && i.source === selected.source && i.project === selected.project) ?? null} />
        ) : (
          <Empty icon={<FileInput size={40} strokeWidth={1.2} />} title="Review imports here">
            Ask Claude Code or Codex to compare a file with Boards and stage the changes, for example “Compare docs/SRS.md with Boards and stage an import”. It shows up here for you to check before anything is written.
          </Empty>
        )}
      </section>
    </div>
  )
}

function SummaryChips({ s }: { s: ImportInfo['summary'] }) {
  return (
    <>
      {s.create > 0 && <span className="pr-chip ok">{s.create} new</span>}
      {s.update > 0 && <span className="pr-chip">{s.update} changed</span>}
      {s.rowsWithConflicts > 0 && <span className="pr-chip warn">{s.rowsWithConflicts} conflict{s.rowsWithConflicts > 1 ? 's' : ''}</span>}
      {s.remove > 0 && <span className="pr-chip bad">{s.remove} only in Boards</span>}
      {s.error > 0 && <span className="pr-chip bad">{s.error} error{s.error > 1 ? 's' : ''}</span>}
    </>
  )
}

function ImportRow({ info, selected, onOpen }: { info: ImportInfo; selected: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`pr-row ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div className="pr-row-top">
        <span className={`pr-dot ${info.status === 'pending' ? '' : info.status === 'applied' ? 'completed' : 'abandoned'}`} />
        <span className="pr-row-title">{sourceName(info)}</span>
      </div>
      <div className="pr-row-meta">
        <span className="faint">{info.project} · {when(info.created)}</span>
        <span className="grow" />
        {info.status === 'pending' ? <SummaryChips s={info.summary} /> : <span className="pr-chip">{STATUS[info.status]}</span>}
      </div>
    </button>
  )
}

// ----- review -----

function ReviewPane({ info }: { info: ImportInfo }) {
  const toast = useUiStore((s) => s.toast)
  const load = useImportStore((s) => s.load)
  const [review, setReview] = useState<ImportReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'load' | 'apply' | 'discard' | null>('load')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /** Row → conflict fields that take the file's value. */
  const [takeFile, setTakeFile] = useState<Record<string, string[]>>({})
  /** Row → field → the file's text as the user edited it. */
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<RowCategory | 'all'>('all')

  const fetchReview = async (keepChoices: boolean) => {
    setBusy('load')
    setError(null)
    try {
      const r = await importCalls.review(info.id)
      const before = new Map((review?.rows ?? []).map((x) => [x.rowKey, x]))
      setReview(r)
      if (keepChoices) {
        // A row that changed in Boards since it was picked must be looked at again.
        const changed = r.rows.filter((x) => { const b = before.get(x.rowKey); return !b || b.fp !== x.fp || b.category !== x.category }).map((x) => x.rowKey)
        const dropped = changed.filter((k) => picked.has(k))
        if (dropped.length) {
          setPicked((p) => new Set([...p].filter((k) => !changed.includes(k))))
          setTakeFile((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !changed.includes(k))))
          setEdits((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !changed.includes(k))))
          setOpen((o) => new Set([...o, ...dropped]))
          toast({ kind: 'info', title: `${dropped.length} picked row${dropped.length > 1 ? 's' : ''} changed in Boards`, detail: 'They were unpicked and opened; check them again.' })
        }
      } else {
        setPicked(new Set(r.rows.filter((x) => PICKED_FIRST.includes(x.category)).map((x) => x.rowKey)))
        setOpen(new Set(r.rows.filter((x) => x.category === 'conflict').map((x) => x.rowKey)))
        setEdits({})
      }
    } catch (e) {
      setError(String((e as { message?: string }).message ?? e))
    } finally {
      setBusy(null)
    }
  }
  useEffect(() => { void fetchReview(false) }, [info.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = review?.rows ?? []
  const byKey = useMemo(() => new Map(rows.map((r) => [r.rowKey, r])), [rows])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.category] = (c[r.category] ?? 0) + 1
    return c
  }, [rows])
  const shown = rows.filter((r) => (tab === 'all' ? r.category !== 'same' : r.category === tab))
  const pickable = (r: ReviewRow) => PICKABLE.includes(r.category)

  /** Picking a row picks the rows it needs: a parent created by this import. */
  const setPick = (r: ReviewRow, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) {
        let cur: ReviewRow | undefined = r
        while (cur && PICKABLE.includes(cur.category)) {
          next.add(cur.rowKey)
          cur = cur.parentRow ? byKey.get(cur.parentRow) : undefined
        }
      } else {
        next.delete(r.rowKey)
        // Children of this row would lose their parent: unpick them too.
        const drop = (key: string) => rows.filter((x) => x.parentRow === key).forEach((x) => { next.delete(x.rowKey); drop(x.rowKey) })
        drop(r.rowKey)
      }
      return next
    })
  }
  const chooseFile = (r: ReviewRow, field: string, file: boolean) => {
    setTakeFile((prev) => {
      const cur = new Set(prev[r.rowKey] ?? [])
      if (file) cur.add(field)
      else cur.delete(field)
      return { ...prev, [r.rowKey]: [...cur] }
    })
    if (file) setPick(r, true)
  }
  /** Use edited text for a field (null: back to the file's); editing a conflict means using the file's side. */
  const editField = (r: ReviewRow, field: string, text: string | null) => {
    setEdits((prev) => {
      const { [field]: _, ...rest } = prev[r.rowKey] ?? {}
      return { ...prev, [r.rowKey]: text === null ? rest : { ...rest, [field]: text } }
    })
    if (text === null) return
    if (r.changes.some((c) => c.field === field && c.kind === 'conflict')) chooseFile(r, field, true)
    else setPick(r, true)
  }
  // Removals are picked one by one, or from their own tab.
  const visiblePickable = shown.filter((r) => pickable(r) && (r.category !== 'missing' || tab === 'missing'))
  const allShownPicked = visiblePickable.length > 0 && visiblePickable.every((r) => picked.has(r.rowKey))
  const toggleShown = () => visiblePickable.forEach((r) => setPick(r, !allShownPicked))

  const chosen = rows.filter((r) => picked.has(r.rowKey) && pickable(r))
  const tally = (c: RowCategory) => chosen.filter((r) => r.category === c).length
  /** Picked rows that will write something: a conflict row where every conflict keeps Boards and nothing is empty writes nothing. */
  const writes = (r: ReviewRow) => r.changes.some((c) => c.kind !== 'conflict' && c.write) || (takeFile[r.rowKey] ?? []).length > 0
  const updates = chosen.filter((r) => (r.category === 'changed' || r.category === 'conflict') && writes(r)).length

  const apply = async () => {
    if (!review || chosen.length === 0) return
    const parts = [
      tally('new') && `create ${tally('new')}`,
      updates && `update ${updates}`,
      tally('missing') && `mark ${tally('missing')} as removed`,
    ].filter(Boolean)
    if (parts.length === 0) {
      toast({ kind: 'info', title: 'Nothing to write', detail: 'The picked rows keep everything as it is in Boards. Pick “Use file” for a conflict to change it.' })
      return
    }
    const ok = await confirmAsync(`This will ${parts.join(', ')} in ${review.project}. Rows you did not pick are left alone.`, { title: `Apply ${chosen.length} change${chosen.length > 1 ? 's' : ''} to Azure DevOps?`, okLabel: 'Apply' })
    if (!ok) return
    setBusy('apply')
    try {
      const picks: ImportPick[] = chosen.map((r) => ({ rowKey: r.rowKey, fp: r.fp, takeFile: takeFile[r.rowKey] ?? [], edits: edits[r.rowKey] ?? {} }))
      const res = await importCalls.apply(info.id, picks)
      toast(res.failed ? { kind: 'error', title: `Applied ${res.done}, ${res.failed} not applied`, detail: 'They stay here to try again; each says why.' } : { kind: 'success', title: `Applied ${res.done} change${res.done === 1 ? '' : 's'}` })
      await load()
      if (res.failed) await fetchReview(false)
    } catch (e) {
      toast({ kind: 'error', title: 'Could not apply the import', detail: String((e as { message?: string }).message ?? e) })
    } finally {
      setBusy(null)
    }
  }
  const discard = async () => {
    if (!(await confirmAsync('Nothing from this import will be written. The AI tool can stage it again.', { title: 'Discard this import?', okLabel: 'Discard', danger: true }))) return
    setBusy('discard')
    try {
      await importCalls.discard(info.id)
      await load()
    } catch (e) {
      toast({ kind: 'error', title: 'Could not discard', detail: String((e as { message?: string }).message ?? e) })
      setBusy(null)
    }
  }

  return (
    <div className="pr-pane">
      <div className="pr-head">
        <div className="pr-head-main">
          <div className="pr-title">{sourceName(info)}</div>
          <div className="pr-sub">
            <span className="faint">{info.project} · staged {when(info.created)} · checked against Boards just now</span>
          </div>
        </div>
        <button type="button" className="icon-btn" title="Check against Boards again" onClick={() => void fetchReview(true)} disabled={!!busy}><RefreshCw size={15} className={busy === 'load' ? 'spin' : ''} /></button>
        <button type="button" className="btn" onClick={() => void discard()} disabled={!!busy}>Discard</button>
        <button type="button" className="btn primary" onClick={() => void apply()} disabled={!!busy || chosen.length === 0}>
          {busy === 'apply' && <span className="spinner" />} Apply {chosen.length || ''}
        </button>
      </div>

      {error ? (
        <Empty title="Could not check this import against Boards" action={<button type="button" className="btn" onClick={() => void fetchReview(true)}>Try again</button>}>{error}</Empty>
      ) : !review ? (
        <div className="empty-state"><span className="spinner lg" /></div>
      ) : (
        <>
          <div className="imp-bar">
            <div className="segmented small">
              {TABS.filter((t) => t === 'all' || counts[t]).map((t) => (
                <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t === 'all' ? 'To do' : CATEGORY[t].tab} <span className="faint">{t === 'all' ? rows.length - (counts.same ?? 0) : counts[t]}</span>
                </button>
              ))}
            </div>
            <span className="grow" />
            {visiblePickable.length > 0 && (
              <label className="imp-check">
                <input type="checkbox" checked={allShownPicked} onChange={toggleShown} /> Pick all shown
              </label>
            )}
            <button type="button" className="btn sm" onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((r) => r.rowKey)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
          </div>
          <div className="imp-rows">
            {info.result && info.result.failed > 0 && (
              <div className="ts-note warn imp-note"><AlertTriangle size={14} /><span className="msg">Last try: {info.result.done} applied, {info.result.failed} not applied: {info.result.results.filter((x) => !x.ok).slice(0, 3).map((x) => `${x.key ?? x.title ?? x.rowKey}: ${x.error}`).join(' · ')}</span></div>
            )}
            {review.removalsHeld && <div className="ts-note warn imp-note"><AlertTriangle size={14} /><span className="msg">{review.removalsHeld}</span></div>}
            {tab === 'missing' || (tab === 'all' && counts.missing) ? (
              <div className="ts-note imp-note"><span className="msg">Items only in Boards are never deleted. Picking one sets it to Removed (when its type has that state), tags it “Removed by import”, and adds a comment saying why.</span></div>
            ) : null}
            {shown.length === 0 && <div className="empty-state" style={{ padding: 32 }}><p>Nothing here.</p></div>}
            {shown.map((r) => (
              <RowCard
                key={r.rowKey}
                row={r}
                org={info.org}
                project={review.project}
                picked={picked.has(r.rowKey)}
                pickable={pickable(r)}
                parentMissing={!!r.parentRow && picked.has(r.rowKey) && !picked.has(r.parentRow)}
                parentLabel={r.parentRow ? byKey.get(r.parentRow)?.key ?? byKey.get(r.parentRow)?.title ?? null : null}
                open={open.has(r.rowKey)}
                takeFile={takeFile[r.rowKey] ?? []}
                edits={edits[r.rowKey] ?? {}}
                onEdit={(field, text) => editField(r, field, text)}
                onPick={(on) => setPick(r, on)}
                onToggle={() => setOpen((o) => { const n = new Set(o); if (n.has(r.rowKey)) n.delete(r.rowKey); else n.add(r.rowKey); return n })}
                onChoose={(field, file) => chooseFile(r, field, file)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RowCard({ row, org, project, picked, pickable, parentMissing, parentLabel, open, takeFile, edits, onEdit, onPick, onToggle, onChoose }: {
  row: ReviewRow; org: string; project: string; picked: boolean; pickable: boolean; parentMissing: boolean; parentLabel: string | null; open: boolean
  takeFile: string[]; edits: Record<string, string>; onEdit: (field: string, text: string | null) => void
  onPick: (on: boolean) => void; onToggle: () => void; onChoose: (field: string, file: boolean) => void
}) {
  const cat = CATEGORY[row.category]
  const changes = row.changes.filter((c) => c.kind !== 'same')
  const conflicts = row.changes.filter((c) => c.kind === 'conflict')
  const undecided = conflicts.filter((c) => !c.locked && !takeFile.includes(c.field)).length
  const what = row.category === 'error' ? null
    : row.category === 'conflict' ? `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}${changes.length > conflicts.length ? `, ${changes.length - conflicts.length} to fill` : ''}`
    : row.category === 'new' ? `${changes.length} field${changes.length === 1 ? '' : 's'}`
    : row.category === 'missing' ? 'not in the file'
    : row.category === 'same' ? 'already the same'
    : `${changes.length} field${changes.length === 1 ? '' : 's'} to fill`
  return (
    <div className={`imp-row ${row.category} ${open ? 'open' : ''} ${picked ? 'picked' : ''}`}>
      <div className="imp-row-head" onClick={onToggle}>
        <input type="checkbox" checked={picked && pickable} disabled={!pickable} title={pickable ? 'Apply this row' : row.category === 'error' ? 'Fix it in the file and stage again' : 'Nothing to do'} onClick={(e) => e.stopPropagation()} onChange={(e) => onPick(e.target.checked)} />
        <span className={`pr-chip ${cat.chip}`}>{cat.label}</span>
        {row.key && <span className="imp-key">{row.key}</span>}
        <span className="imp-title">{row.title ?? <span className="faint">No title</span>}</span>
        <span className="grow" />
        {what && <span className="faint imp-what">{what}</span>}
        {row.workItemId !== null && (
          <button type="button" className="imp-link" title="Open in Azure DevOps" onClick={(e) => { e.stopPropagation(); void api().openUrl(itemUrl(org, project, row.workItemId!)) }}>
            #{row.workItemId} <ExternalLink size={11} />
          </button>
        )}
        <ChevronDown size={14} className="imp-chev" />
      </div>
      {open && (
        <div className="imp-body">
          {row.error && <div className="ts-note danger"><AlertTriangle size={14} /><span className="msg">{row.error}</span></div>}
          {row.note && <div className="ts-note"><span className="msg">{row.note}</span></div>}
          {parentMissing && <div className="ts-note"><span className="msg">Its parent ({parentLabel ?? 'another row'}) is not picked, so this row would be left alone.</span></div>}
          {picked && undecided > 0 && <div className="imp-hint faint">Conflicts keep the text in Boards unless you pick “Use file”.</div>}
          {row.matchedBy === 'title' && <div className="imp-hint faint">Matched by title: this item in Boards has no {row.type} key yet.</div>}
          {row.changes.length === 0 && !row.error && <div className="faint">No fields.</div>}
          {(row.category === 'same' ? row.changes : changes).map((c) => (
            <FieldDiff key={c.field} change={c} isNew={row.category === 'new'} removal={row.category === 'missing'} useFile={takeFile.includes(c.field)} onChoose={(file) => onChoose(c.field, file)}
              editable={canEdit(row, c)} edited={edits[c.field]} onEdit={(text) => onEdit(c.field, text)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The file's text can be edited where it would be written; not links, the parent, or the key the row is matched on. */
export function canEdit(row: ReviewRow, c: FieldChange): boolean {
  if (row.category !== 'new' && row.category !== 'changed' && row.category !== 'conflict') return false
  if (c.kind !== 'fill' && c.kind !== 'conflict' && !(row.category === 'new' && c.kind !== 'add')) return false
  return !c.locked && c.field !== 'System.Parent' && !(row.key && c.after.trim() === row.key.trim())
}

function FieldDiff({ change, isNew, removal, useFile, onChoose, editable, edited, onEdit }: {
  change: FieldChange; isNew: boolean; removal: boolean; useFile: boolean; onChoose: (file: boolean) => void
  editable: boolean; edited: string | undefined; onEdit: (text: string | null) => void
}) {
  const label = change.kind === 'fill' ? 'Empty in Boards' : change.kind === 'conflict' ? 'Different in Boards' : change.kind === 'add' ? 'Adds links' : null
  const fileText = edited ?? change.after
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    if (draft === null) return
    onEdit(draft === change.after ? null : draft)
    setDraft(null)
  }
  const fileSide = draft !== null ? (
    <div className="imp-edit">
      <textarea className="textarea" title="Plain text; line breaks are kept. Cmd/Ctrl+Enter saves, Esc cancels." aria-label={`${change.name} in the file`} autoFocus value={draft} rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null) }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
        }} />
      <div className="imp-edit-actions">
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => setDraft(null)}>Cancel</button>
        <button type="button" className="btn sm primary" onClick={save}>Save</button>
      </div>
    </div>
  ) : (
    <div className="imp-text">{fileText || <span className="faint">Empty</span>}</div>
  )
  return (
    <div className={`imp-field ${change.kind}`}>
      <div className="imp-field-h">
        <span className="imp-field-name">{change.name}</span>
        {label && <span className={`pr-chip ${change.kind === 'conflict' ? 'warn' : ''}`}>{label}</span>}
        <span className="grow" />
        {edited !== undefined && <span className="pr-chip" title="You edited the file's text; this is what will be written">Edited</span>}
        {edited !== undefined && draft === null && <button type="button" className="btn sm ghost" onClick={() => onEdit(null)}>Use original</button>}
        {editable && draft === null && <button type="button" className="btn sm ghost" title="Change the file's text before applying" onClick={() => setDraft(fileText)}><Pencil size={12} /> Edit</button>}
        {change.kind === 'conflict' && change.locked && <span className="faint imp-hint">{change.locked}</span>}
        {change.kind === 'conflict' && !change.locked && (
          <div className="segmented small">
            <button type="button" className={!useFile ? 'on' : ''} onClick={() => onChoose(false)}>Keep Boards</button>
            <button type="button" className={useFile ? 'on' : ''} onClick={() => onChoose(true)}>Use file</button>
          </div>
        )}
      </div>
      {isNew ? (
        fileSide
      ) : (
        <div className="imp-cols">
          <div className={`imp-side before ${change.kind === 'conflict' && !useFile ? 'kept' : ''}`}>
            <div className="imp-side-h">In Boards</div>
            <div className="imp-text">{change.before || <span className="faint">Empty</span>}</div>
          </div>
          <div className={`imp-side after ${change.kind !== 'conflict' || useFile ? 'kept' : ''}`}>
            <div className="imp-side-h">{removal ? 'After' : 'In the file'}</div>
            {fileSide}
          </div>
        </div>
      )}
    </div>
  )
}

// ----- after -----

function ResultPane({ info, newer, onOpen }: { info: ImportInfo; newer: ImportInfo | null; onOpen: (id: string) => void }) {
  const r: ImportResult | null = info.result
  const failed = r?.results.filter((x) => !x.ok) ?? []
  const done = r?.results.filter((x) => x.ok && !x.skipped) ?? []
  return (
    <div className="pr-pane">
      <div className="pr-head">
        <div className="pr-head-main">
          <div className="pr-title">{sourceName(info)}</div>
          <div className="pr-sub">
            <span className="faint">{info.project} · {STATUS[info.status].toLowerCase()} {info.finished ? when(info.finished) : ''}</span>
          </div>
        </div>
      </div>
      {info.status === 'applying' ? (
        <div className="empty-state"><span className="spinner lg" /><p>Writing to Azure DevOps…</p></div>
      ) : info.status === 'superseded' ? (
        <Empty title="Replaced by a newer import" action={newer ? <button type="button" className="btn primary" onClick={() => onOpen(newer.id)}>Review the newer one</button> : undefined}>The AI tool staged this file again. Nothing from this version was written.</Empty>
      ) : info.status === 'discarded' || !r ? (
        <Empty title="Discarded">Nothing from this import was written.</Empty>
      ) : (
        <div className="imp-rows">
          <div className="imp-result-sum">
            <span className="pr-chip ok">{r.done} applied</span>
            {r.failed > 0 && <span className="pr-chip bad">{r.failed} failed</span>}
            {r.unchanged > 0 && <span className="pr-chip">{r.unchanged} already the same</span>}
            {r.notPicked > 0 && <span className="pr-chip">{r.notPicked} not picked</span>}
          </div>
          {failed.length > 0 && <div className="pr-group">Failed</div>}
          {failed.map((x) => (
            <div key={x.rowKey} className="imp-result bad">
              <span className="imp-key">{x.key}</span><span className="imp-title">{x.title}</span>
              <div className="imp-result-err">{x.error}</div>
            </div>
          ))}
          {done.length > 0 && <div className="pr-group">Applied</div>}
          {done.map((x) => (
            <div key={x.rowKey} className="imp-result">
              <span className="imp-key">{x.key}</span><span className="imp-title">{x.title}</span>
              <span className="grow" />
              <span className="faint">{x.note ?? (x.action === 'create' || x.action === 'new' ? 'Created' : x.action === 'remove' || x.action === 'missing' ? 'Marked removed' : 'Updated')}</span>
              {x.workItemId !== null && (
                <button type="button" className="imp-link" onClick={() => void api().openUrl(itemUrl(info.org, info.project, x.workItemId!))}>#{x.workItemId} <ExternalLink size={11} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
