import DOMPurify from 'dompurify'
import { ArrowLeft, ChevronDown, ExternalLink, GitBranch, Link2, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { REPRO_STEPS, customFieldsFor, fieldKind, isIdLike, symptomField, usesReproSteps } from '@/lib/customFields'
import { hydrateImages } from '@/lib/attachments'
import { htmlToText, identityKey, itemUrl, longDate, relativeTime, typeColor } from '@/lib/format'
import type { Comment, WorkItem, WorkItemType } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { CustomFieldInput } from '@/components/ui/CustomFieldInput'
import { Dropdown, type Option } from '@/components/ui/Dropdown'
import { useAppStore } from '@/store/useAppStore'
import { projectOf, useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { useUiStore } from '@/store/useUiStore'
import { RichText } from './RichText'
import { HistorySection } from './HistorySection'
import { DevSection } from './DevSection'
import { Popover } from '@/components/ui/Popover'
import { ModulePicker } from '@/components/ui/ModulePicker'
import { MentionTextarea } from '@/components/ui/MentionTextarea'
import { toWorkItemMentionHtml } from '@/lib/mentions'

const NO_TYPES: WorkItemType[] = []

export function Inspector({ floating }: { floating?: boolean }) {
  const selectedId = useBoardStore((s) => s.selectedId)
  const item = useBoardStore((s) => (s.selectedId !== null ? s.items.find((i) => i.id === s.selectedId) ?? (s.detached?.id === s.selectedId ? s.detached : null) : null))
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const cls = `inspector ${floating ? 'floating' : ''}`
  if (!item) {
    return (
      <aside className={cls}>
        <div className="inspector-head"><span className="grow">Details</span><button type="button" className="icon-btn sm" onClick={() => toggleInspector(false)}><X size={15} /></button></div>
        <div className="inspector-empty">
          {selectedId ? <span className="spinner" /> : <span>Select an item to see its details.</span>}
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Arrow keys move between cards · Enter opens</span>
        </div>
      </aside>
    )
  }
  return <ItemDetails key={item.id} item={item} className={cls} />
}

function ItemDetails({ item, className }: { item: WorkItem; className: string }) {
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const project = projectOf(item)
  const ctx = useBoardStore((s) => s.ctx)
  // The board context belongs to the selected project; an item opened from My Work may come from another one.
  const sameProject = useAppStore((s) => s.selectedProject?.name === project)
  const otherTypes = useMyWorkStore((s) => s.types[project])
  const projectTypes = (sameProject ? ctx?.workItemTypes : otherTypes) ?? []
  const board = useBoardStore((s) => s.board)
  const onBoard = useBoardStore((s) => s.items.some((i) => i.id === item.id))
  const history = useBoardStore((s) => s.history)
  const goBack = useBoardStore((s) => s.goBack)
  const openItem = useBoardStore((s) => s.openItem)
  const pending = useBoardStore((s) => s.pending.has(item.id))
  const updateFields = useBoardStore((s) => s.updateFields)
  const assign = useBoardStore((s) => s.assign)
  const moveToColumn = useBoardStore((s) => s.moveToColumn)
  const reloadItem = useBoardStore((s) => s.reloadItem)
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const openSheet = useUiStore((s) => s.openSheet)
  const toast = useUiStore((s) => s.toast)

  const f = item.fields
  const type = String(f['System.WorkItemType'] ?? '')
  const wit = projectTypes.find((t) => t.name === type)
  const allCustomDefs = customFieldsFor(wit)
  const reproType = type === 'Bug' || usesReproSteps(wit)
  // Only a rich-text Symptom gets its own section; a plain one stays with the other fields.
  const symptomDef = ((d) => (d && (d.referenceName.startsWith('Microsoft.') || fieldKind(ctx, d) === 'html') ? d : undefined))(symptomField(wit))
  const customDefs = allCustomDefs.filter((d) => fieldKind(ctx, d) !== 'html')
  const htmlDefs = allCustomDefs.filter((d) => fieldKind(ctx, d) === 'html')
  const who = f['System.AssignedTo'] as { displayName?: string; uniqueName?: string; id?: string } | undefined
  const createdBy = f['System.CreatedBy'] as { displayName?: string; uniqueName?: string } | undefined
  const [menu, setMenu] = useState<null | 'who' | 'state' | 'iter' | 'pri'>(null)
  const whoBtn = useRef<HTMLButtonElement>(null)
  const stateBtn = useRef<HTMLButtonElement>(null)
  const iterBtn = useRef<HTMLButtonElement>(null)
  const priBtn = useRef<HTMLButtonElement>(null)
  const [title, setTitle] = useState(String(f['System.Title'] ?? ''))
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [children, setChildren] = useState<WorkItem[] | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const tags = String(f['System.Tags'] ?? '').split(';').map((t) => t.trim()).filter(Boolean)

  useEffect(() => setTitle(String(f['System.Title'] ?? '')), [f])
  useEffect(() => {
    const el = titleRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [title])
  useEffect(() => {
    let live = true
    void reloadItem(item.id)
    api().getComments(org, project, item.id).then((c) => live && setComments(c)).catch(() => live && setComments([]))
    api().getChildren(org, project, item.id).then((c) => live && setChildren(c)).catch(() => live && setChildren([]))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, org, project])

  const saveTitle = () => {
    const t = title.trim()
    if (!t) { setTitle(String(f['System.Title'] ?? '')); return }
    if (t !== f['System.Title']) void updateFields(item.id, { 'System.Title': t })
  }

  const stateOptions: Option[] = (wit?.states ?? []).filter((s) => s.category !== 'Removed').map((s) => ({ value: s.name, label: s.name }))
  const whoOptions: Option[] = [{ value: '', label: 'Unassigned' }, ...(ctx?.members ?? []).map((m) => ({ value: identityKey(m), label: m.displayName, sub: m.uniqueName ?? undefined }))]
  const iterOptions: Option[] = (ctx?.iterations ?? []).map((i) => ({ value: i.path, label: i.name, sub: i.attributes?.timeFrame === 'current' ? 'current' : undefined }))
  if (ctx?.settings?.backlogIteration) iterOptions.unshift({ value: ctx.settings.backlogIteration.path, label: 'Backlog', sub: ctx.settings.backlogIteration.name })
  const priOptions: Option[] = ['1', '2', '3', '4'].map((p) => ({ value: p, label: `P${p}`, sub: p === '1' ? 'Must fix' : p === '2' ? 'High' : p === '3' ? 'Normal' : 'Low' }))

  const setState = (state: string) => {
    const col = onBoard ? board?.columns.find((c) => c.stateMappings?.[type] === state) : undefined
    if (col) void moveToColumn(item.id, col.name, false)
    else void updateFields(item.id, { 'System.State': state })
  }
  const addTag = () => {
    const t = tagInput.trim().replace(/;/g, '')
    if (!t) return
    if (!tags.includes(t)) void updateFields(item.id, { 'System.Tags': [...tags, t].join('; ') })
    setTagInput('')
  }
  const removeTag = (t: string) => void updateFields(item.id, { 'System.Tags': tags.filter((x) => x !== t).join('; ') || null })

  const sendComment = async () => {
    const text = comment.trim()
    if (!text) return
    setSending(true)
    try {
      const c = await api().addComment(org, project, item.id, toWorkItemMentionHtml(text, ctx?.members ?? [], org).replace(/\n/g, '<br>'))
      setComments((cs) => [...(cs ?? []), c])
      setComment('')
    } catch (e) {
      toast({ kind: 'error', title: 'Could not post comment', detail: String((e as { message?: string }).message ?? e) })
    } finally {
      setSending(false)
    }
  }

  const pointsField = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size'].find((k) => k in f) ?? (type === 'User Story' ? 'Microsoft.VSTS.Scheduling.StoryPoints' : ['Product Backlog Item', 'Feature', 'Epic'].includes(type) ? 'Microsoft.VSTS.Scheduling.Effort' : null)
  const remainingField = 'Microsoft.VSTS.Scheduling.RemainingWork'
  const parentId = parentIdOf(item)
  const stateColorHex = `#${(wit?.states.find((s) => s.name === f['System.State'])?.color ?? '888').replace('#', '')}`

  return (
    <aside className={className} style={{ ['--type-color' as string]: typeColor(projectTypes, type) }}>
      <div className="inspector-head">
        {history.length > 0 && <button type="button" className="icon-btn sm" title="Back" onClick={goBack}><ArrowLeft size={15} /></button>}
        <span className="type-chip"><span className="sw" />{type}</span>
        <span className="id selectable">#{item.id}</span>
        {!sameProject && <span className="faint">· {project}</span>}
        {pending && <span className="spinner" style={{ width: 12, height: 12 }} />}
        <span className="grow" />
        <button type="button" className="icon-btn sm" title="Start work: create a branch" onClick={() => openSheet('start-work', { id: item.id })}><GitBranch size={15} /></button>
        <button type="button" className="icon-btn sm" title="Copy link" onClick={() => { void navigator.clipboard.writeText(itemUrl(org, project, item.id)); toast({ kind: 'success', title: 'Link copied' }) }}><Link2 size={15} /></button>
        <button type="button" className="icon-btn sm" title="Open in Azure DevOps" onClick={() => void api().openUrl(itemUrl(org, project, item.id))}><ExternalLink size={15} /></button>
        <button type="button" className="icon-btn sm" title="Reload" onClick={() => void reloadItem(item.id)}><RefreshCw size={14} /></button>
        <button type="button" className="icon-btn sm" title="Close (Esc)" onClick={() => toggleInspector(false)}><X size={15} /></button>
      </div>
      <div className="inspector-body">
        <textarea
          ref={titleRef}
          className="insp-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } if (e.key === 'Escape') { setTitle(String(f['System.Title'] ?? '')); (e.target as HTMLTextAreaElement).blur() } }}
          spellCheck
        />

        <div className="insp-grid">
          {customDefs.map((d) => (
            <CustomRow key={d.referenceName} def={d} value={f[d.referenceName]} onSave={(v) => void updateFields(item.id, { [d.referenceName]: v })} />
          ))}

          <span className="k">Assigned to</span>
          <span className="v">
            <button ref={whoBtn} type="button" className={`field-btn ${who ? '' : 'empty'}`} onClick={() => setMenu('who')}>
              <Avatar name={who?.displayName} keyName={who?.uniqueName} size="sm" />
              <span className="txt">{who?.displayName ?? 'Unassigned'}</span>
              <ChevronDown size={14} className="chev" />
            </button>
            <Dropdown anchor={whoBtn.current} open={menu === 'who'} onClose={() => setMenu(null)} options={whoOptions} value={who ? identityKey(who) : ''} searchable placeholder="Search people" width={280} onSelect={(v) => void assign(item.id, v || null)} />
          </span>

          <span className="k">State</span>
          <span className="v">
            <button ref={stateBtn} type="button" className="field-btn" onClick={() => setMenu('state')} disabled={stateOptions.length === 0}>
              <span style={{ width: 9, height: 9, borderRadius: 5, display: 'inline-block', background: stateColorHex }} />
              <span className="txt">{String(f['System.State'] ?? '')}</span>
              <ChevronDown size={14} className="chev" />
            </button>
            <Dropdown anchor={stateBtn.current} open={menu === 'state'} onClose={() => setMenu(null)} options={stateOptions} value={String(f['System.State'] ?? '')} width={220} onSelect={setState} />
          </span>

          <span className="k">Iteration</span>
          <span className="v">
            <button ref={iterBtn} type="button" className="field-btn" onClick={() => setMenu('iter')} disabled={!sameProject}>
              <span className="txt">{String(f['System.IterationPath'] ?? '').split('\\').slice(1).join(' › ') || String(f['System.IterationPath'] ?? '')}</span>
              <ChevronDown size={14} className="chev" />
            </button>
            <Dropdown anchor={iterBtn.current} open={menu === 'iter'} onClose={() => setMenu(null)} options={iterOptions} value={String(f['System.IterationPath'] ?? '')} searchable width={280} onSelect={(v) => void updateFields(item.id, { 'System.IterationPath': v })} />
          </span>

          <span className="k">Priority</span>
          <span className="v">
            <button ref={priBtn} type="button" className={`field-btn ${f['Microsoft.VSTS.Common.Priority'] ? '' : 'empty'}`} onClick={() => setMenu('pri')}>
              <span className="txt">{f['Microsoft.VSTS.Common.Priority'] ? `P${f['Microsoft.VSTS.Common.Priority']}` : 'Not set'}</span>
              <ChevronDown size={14} className="chev" />
            </button>
            <Dropdown anchor={priBtn.current} open={menu === 'pri'} onClose={() => setMenu(null)} options={priOptions} value={String(f['Microsoft.VSTS.Common.Priority'] ?? '')} width={200} onSelect={(v) => void updateFields(item.id, { 'Microsoft.VSTS.Common.Priority': Number(v) })} />
          </span>

          {pointsField && (
            <>
              <span className="k">{pointsField.endsWith('StoryPoints') ? 'Story points' : pointsField.endsWith('Effort') ? 'Effort' : 'Size'}</span>
              <span className="v"><NumberField value={f[pointsField] as number | undefined} onSave={(n) => void updateFields(item.id, { [pointsField]: n })} /></span>
            </>
          )}
          {type === 'Task' && (
            <>
              <span className="k">Remaining</span>
              <span className="v"><NumberField value={f[remainingField] as number | undefined} onSave={(n) => void updateFields(item.id, { [remainingField]: n })} suffix="h" /></span>
            </>
          )}

          <span className="k" title="Area path in Azure DevOps">Module</span>
          <span className="v"><ModulePicker project={project} value={String(f['System.AreaPath'] ?? '')} onChange={(path) => void updateFields(item.id, { 'System.AreaPath': path })} /></span>

          <span className="k">Tags</span>
          <span className="v">
            <div className="tagrow">
              {tags.map((t) => (<span key={t} className="tag">{t}<button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><X size={11} /></button></span>))}
              <input list={`tags-${item.id}`} value={tagInput} placeholder={tags.length ? 'Add tag' : 'Add a tag…'} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }} onBlur={addTag} />
              <datalist id={`tags-${item.id}`}>{(ctx?.tags ?? []).map((t) => <option key={t} value={t} />)}</datalist>
            </div>
          </span>

          <span className="k">Parent</span>
          <span className="v"><ParentField item={item} parentId={parentId} project={project} /></span>

          <span className="k">{type === 'Bug' ? 'Reported by' : 'Created by'}</span>
          <span className="v">
            <span className="field-btn" style={{ pointerEvents: 'none' }}>
              <Avatar name={createdBy?.displayName} keyName={createdBy?.uniqueName} size="sm" />
              <span className="txt">{createdBy?.displayName ?? '—'}</span>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{relativeTime(f['System.CreatedDate'])}</span>
            </span>
          </span>
        </div>

        {/* Bugs keep their write-up in Repro Steps; Description only shows there when it already has text. */}
        {(!reproType || !!f['System.Description']) && (
          <>
            <div className="section-h">Description</div>
            <RichText project={project} html={f['System.Description'] as string | undefined} placeholder="Add a description…" onSave={(html) => void updateFields(item.id, { 'System.Description': html || null })} />
          </>
        )}
        {htmlDefs.filter((d) => d.referenceName !== symptomDef?.referenceName).map((d) => (
          <div key={d.referenceName}>
            <div className="section-h">{d.name}{d.alwaysRequired && <span className="req" title="Required">*</span>}</div>
            <RichText project={project} html={f[d.referenceName] as string | undefined} placeholder={d.helpText || `Add ${d.name.toLowerCase()}…`} onSave={(html) => void updateFields(item.id, { [d.referenceName]: html || null })} />
          </div>
        ))}

        {(reproType || REPRO_STEPS in f) && (
          <>
            <div className="section-h">Repro steps</div>
            <RichText project={project} html={f[REPRO_STEPS] as string | undefined} placeholder="How to reproduce… (paste screenshots here)" onSave={(html) => void updateFields(item.id, { [REPRO_STEPS]: html || null })} />
          </>
        )}
        {symptomDef && (
          <>
            <div className="section-h">{symptomDef.name}{symptomDef.alwaysRequired && <span className="req" title="Required">*</span>}</div>
            <RichText project={project} html={f[symptomDef.referenceName] as string | undefined} placeholder="What does the user see? (paste screenshots here)" onSave={(html) => void updateFields(item.id, { [symptomDef.referenceName]: html || null })} />
          </>
        )}
        {(type === 'User Story' || type === 'Product Backlog Item' || 'Microsoft.VSTS.Common.AcceptanceCriteria' in f) && (
          <>
            <div className="section-h">Acceptance criteria</div>
            <RichText project={project} html={f['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined} placeholder="What does done look like?" onSave={(html) => void updateFields(item.id, { 'Microsoft.VSTS.Common.AcceptanceCriteria': html || null })} />
          </>
        )}

        <div className="section-h">
          <span>Child items{children && children.length ? ` · ${children.length}` : ''}</span>
          <span className="grow" />
          {sameProject && <button type="button" className="icon-btn sm" title="Add child task" onClick={() => openSheet('new-item', { parentId: item.id, type: 'Task' })}><Plus size={14} /></button>}
        </div>
        {children === null ? <div className="skeleton" style={{ height: 24 }} /> : children.length === 0 ? <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>No child items.</div> : children.map((c) => <ChildRow key={c.id} item={c} onOpen={() => void openItem(c, { push: true })} />)}

        <DevSection item={item} org={org} canStart />

        <div className="section-h">Discussion{comments && comments.length ? ` · ${comments.length}` : ''}</div>
        {comments === null ? <div className="skeleton" style={{ height: 40 }} /> : comments.map((c) => (
          <div key={c.id} className="comment">
            <Avatar name={c.createdBy?.displayName} keyName={c.createdBy?.uniqueName} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div><span className="who">{c.createdBy?.displayName}</span><span className="when" title={longDate(c.createdDate)}>{relativeTime(c.createdDate)}</span></div>
              <CommentBody html={c.text ?? ''} org={org} />
            </div>
          </div>
        ))}
        <div className="comment-box">
          <MentionTextarea people={ctx?.members ?? []} org={org} project={project} value={comment} placeholder="Write a comment… (@ person, # work item, ! pull request)" onChange={setComment} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void sendComment() }} />
          <div className="row">
            <span className="hint">@ person · # work item · ! pull request</span>
            <button type="button" className="btn sm primary" disabled={sending || !comment.trim()} onClick={() => void sendComment()}>{sending ? 'Posting…' : 'Post'}</button>
          </div>
        </div>

        <HistorySection org={org} project={project} id={item.id} rev={item.rev} types={projectTypes} fieldTypes={ctx?.fieldTypes ?? {}} />

        <div className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 20, lineHeight: 1.6 }}>
          Created {longDate(f['System.CreatedDate'])} by {createdBy?.displayName}<br />
          Changed {longDate(f['System.ChangedDate'])} by {(f['System.ChangedBy'] as { displayName?: string } | undefined)?.displayName}
        </div>
      </div>
    </aside>
  )
}

function CustomRow({ def, value, onSave }: { def: import('@/lib/types').FieldDef; value: unknown; onSave: (v: unknown) => void }) {
  if (isIdLike(def)) {
    return (
      <>
        <span className="k">{def.name}</span>
        <span className="v"><span className="field-text selectable">{htmlToText(String(value ?? '')) || <span className="faint">—</span>}</span></span>
      </>
    )
  }
  return <CustomEditRow def={def} value={value} onSave={onSave} />
}

function CustomEditRow({ def, value, onSave }: { def: import('@/lib/types').FieldDef; value: unknown; onSave: (v: unknown) => void }) {
  const ctx = useBoardStore((s) => s.ctx)
  const [v, setV] = useState<unknown>(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value && !(v === null && (value === undefined || value === ''))) onSave(v) }
  return (
    <>
      <span className="k">{def.name}{def.alwaysRequired && <span className="req" title="Required">*</span>}</span>
      <span className="v" onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}>
        <CustomFieldInput def={def} ctx={ctx} value={v} onChange={(nv) => { setV(nv); if (typeof nv === 'boolean' || (def.allowedValues && def.allowedValues.length > 0)) onSave(nv) }} className="field-input" compact />
      </span>
    </>
  )
}

function CommentBody({ html, org }: { html: string; org: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
    hydrateImages(ref.current, org)
  }, [html, org])
  return <div ref={ref} className="body" />
}

function NumberField({ value, onSave, suffix }: { value: number | undefined; onSave: (n: number | null) => void; suffix?: string }) {
  const [v, setV] = useState(value === undefined ? '' : String(value))
  useEffect(() => setV(value === undefined ? '' : String(value)), [value])
  const commit = () => {
    const t = v.trim()
    if (t === '') { if (value !== undefined) onSave(null); return }
    const n = Number(t)
    if (Number.isNaN(n)) { setV(value === undefined ? '' : String(value)); return }
    if (n !== value) onSave(n)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input className="field-input" style={{ width: 80 }} inputMode="decimal" value={v} placeholder="—" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value === undefined ? '' : String(value)); (e.target as HTMLInputElement).blur() } }} />
      {suffix && <span className="faint">{suffix}</span>}
    </span>
  )
}

function ChildRow({ item, onOpen }: { item: WorkItem; onOpen: () => void }) {
  const types = useBoardStore((s) => s.ctx?.workItemTypes ?? NO_TYPES)
  const type = String(item.fields['System.WorkItemType'] ?? '')
  const who = item.fields['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
  return (
    <button type="button" className="child-row" style={{ ['--type-color' as string]: typeColor(types, type), width: '100%', textAlign: 'left' }} onClick={onOpen} title="Show details">
      <span className="sw" />
      <span className="id">#{item.id}</span>
      <span className="t">{String(item.fields['System.Title'] ?? '')}</span>
      <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{String(item.fields['System.State'] ?? '')}</span>
      <Avatar name={who?.displayName} keyName={who?.uniqueName} size="sm" />
    </button>
  )
}

/** The parent from the field, or from the item's links when the field is missing. */
function parentIdOf(item: WorkItem): number | undefined {
  const p = item.fields['System.Parent']
  if (typeof p === 'number') return p
  const rel = item.relations?.find((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse')
  const id = rel ? Number(rel.url.split('/').pop()) : NaN
  return Number.isFinite(id) ? id : undefined
}

/** Shows the parent and lets it be set, changed or removed. Tasks, bugs, CRs and issues usually sit under a requirement. */
function ParentField({ item, parentId, project }: { item: WorkItem; parentId: number | undefined; project: string }) {
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const upsert = useBoardStore((s) => s.upsert)
  const toast = useUiStore((s) => s.toast)
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WorkItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const text = q.trim()
    if (!text) { setHits(null); return }
    let live = true
    const t = setTimeout(() => {
      api().searchWorkItems(org, /^\d+$/.test(text) ? null : project, text)
        .then((r) => { if (live) setHits(r.filter((w) => w.id !== item.id).slice(0, 10)) })
        .catch(() => live && setHits([]))
    }, 220)
    return () => { live = false; clearTimeout(t) }
  }, [q, open, org, project, item.id])

  const apply = async (pid: number | null) => {
    setOpen(false); setQ(''); setBusy(true)
    try {
      const updated = await api().setParent(org, project, item.id, pid)
      upsert({ ...updated, fields: { ...updated.fields, 'System.Parent': pid ?? undefined } })
      toast({ kind: 'success', title: pid ? `Parent set to #${pid}` : 'Parent removed' })
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the parent', detail: String((e as { message?: string }).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="parent-field">
      {parentId ? <ParentLink id={parentId} project={project} /> : <span className="faint">None</span>}
      <button ref={btn} type="button" className="btn sm ghost" disabled={busy} onClick={() => setOpen(true)}>{busy ? 'Saving…' : parentId ? 'Change' : 'Set parent…'}</button>
      <Popover anchor={btn.current} open={open} onClose={() => { setOpen(false); setQ('') }} width={360} className="parent-pop">
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number or title" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
        <div className="parent-hits">
          {hits === null ? <div className="pop-hint">Type a work item number or words from its title</div>
            : hits.length === 0 ? <div className="pop-hint">Nothing found</div>
              : hits.map((w) => (
                <button key={w.id} type="button" className="pop-item" onClick={() => void apply(w.id)}>
                  <span className="mention-id">#{w.id}</span>
                  <span className="label">{String(w.fields['System.Title'] ?? '')}</span>
                  <span className="sub">{String(w.fields['System.WorkItemType'] ?? '')}</span>
                </button>
              ))}
        </div>
        {parentId && <button type="button" className="pop-item danger" onClick={() => void apply(null)}>Remove parent</button>}
      </Popover>
    </span>
  )
}

function ParentLink({ id, project }: { id: number; project: string }) {
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const parent = useBoardStore((s) => s.items.find((i) => i.id === id))
  const openItem = useBoardStore((s) => s.openItem)
  const [title, setTitle] = useState<string | null>(parent ? String(parent.fields['System.Title']) : null)
  const [typeName, setTypeName] = useState<string>(parent ? String(parent.fields['System.WorkItemType']) : '')
  useEffect(() => {
    if (parent) { setTitle(String(parent.fields['System.Title'])); setTypeName(String(parent.fields['System.WorkItemType'])); return }
    let live = true
    api().getWorkItem(org, project, id).then((w) => { if (live) { setTitle(String(w.fields['System.Title'] ?? '')); setTypeName(String(w.fields['System.WorkItemType'] ?? '')) } }).catch(() => live && setTitle(''))
    return () => { live = false }
  }, [id, org, project, parent])
  return (
    <button type="button" className="field-btn" onClick={() => void openItem(id, { project, push: true })} title="Show parent">
      <span className="faint">{typeName ? `${typeName} ` : ''}#{id}</span>
      <span className="txt">{title === null ? '…' : htmlToText(title) || 'Untitled'}</span>
    </button>
  )
}
