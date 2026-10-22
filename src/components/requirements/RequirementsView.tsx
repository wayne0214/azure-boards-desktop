import DOMPurify from 'dompurify'
import { useShallow } from 'zustand/react/shallow'
import { AlertTriangle, Bug, CheckSquare, FilePen, ChevronDown, Square, Tags, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download, FileText, ListTree, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Empty } from '@/components/ui/Empty'
import { Sheet } from '@/components/ui/Sheet'
import { api } from '@/lib/api'
import { hydrateImages } from '@/lib/attachments'
import { stateColor, typeColor } from '@/lib/format'
import { DISCIPLINES, looksLikeTask, parentIdOfItem, buildCsv, buildDocument, buildTree, disciplineOf, disciplineSummary, idOf, isTaskDone, titleWithoutPrefix, type Discipline, type ReqNode, type ReqTree } from '@/lib/requirements'
import type { WorkItem, WorkItemType } from '@/lib/types'
import { confirmAsync } from '@/lib/confirm'
import { copyRichText, DOC_EXPORT_CSS } from '@/lib/docExport'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { ensureReqLoaded, useReqStore, type ReqFilter } from '@/store/useReqStore'
import { useUiStore } from '@/store/useUiStore'

const FILTERS: { v: ReqFilter; l: string }[] = [
  { v: 'all', l: 'All' },
  { v: 'gaps', l: 'Needs attention' },
  { v: 'changes', l: 'Under change' },
  { v: 'recent', l: 'Changed this week' },
  { v: 'mine', l: 'Mine' },
]

/** The project's UN > DI > SRS requirements: write them as an outline, check them, read them as a document. */
export function RequirementsView() {
  const project = useAppStore((s) => s.selectedProject)
  const ctx = useBoardStore((s) => s.ctx)
  const ctxLoading = useAppStore((s) => s.contextLoading)
  const s = useReqStore(useShallow((st) => ({ bugs: st.bugs, cfg: st.cfg, changes: st.changes, error: st.error, items: st.items, load: st.load, loading: st.loading, mode: st.mode, setMode: st.setMode, tasks: st.tasks })))
  const setView = useUiStore((u) => u.setView)

  // Load once the project's process (types and fields) is known, and again when the project changes.
  useEffect(() => {
    if (!project || !ctx) return
    ensureReqLoaded(project.name, ctx)
  }, [project, ctx])

  const types = ctx?.workItemTypes ?? []
  const tree = useMemo(() => (s.cfg ? buildTree(s.cfg, types, s.items, s.bugs, s.tasks, s.changes) : null), [s.cfg, types, s.items, s.bugs, s.tasks, s.changes])

  if (!project) return <Empty title="Choose a project">Pick a project in the sidebar to see its requirements.</Empty>
  if (!ctx || (ctxLoading && !s.cfg)) return <div className="empty-state"><span className="spinner lg" /><p>Loading {project.name}…</p></div>
  if (!s.cfg) {
    return (
      <Empty icon={<ListTree size={28} />} title="No requirement hierarchy in this project" action={<button type="button" className="btn" onClick={() => setView('board')}>Open the board</button>}>
        This view needs Epic, Feature and Requirement (or User Story) work item types.
      </Empty>
    )
  }

  const [un, di, srs] = s.cfg.tiers
  const nodes = tree ? [...tree.byId.values()] : []
  const counts = tree ? { un: nodes.filter((n) => n.tier.level === 0).length, di: nodes.filter((n) => n.tier.level === 1).length, srs: nodes.filter((n) => n.tier.level === 2).length } : null
  const attention = nodes.filter((n) => n.gaps.length || n.bugs.length).length

  return (
    <div className="req">
      <div className="req-head">
        <div className="req-title">
          <strong>Requirements</strong>
          {counts && <span className="faint">{counts.un} {un.label} · {counts.di} {di.label} · {counts.srs} {srs.label}</span>}
        </div>
        <div className="segmented">
          <button type="button" className={s.mode === 'outline' ? 'on' : ''} onClick={() => s.setMode('outline')}><ListTree size={14} /> Outline</button>
          <button type="button" className={s.mode === 'document' ? 'on' : ''} onClick={() => s.setMode('document')}><FileText size={14} /> Document</button>
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn" title="Reload" onClick={() => void s.load()} disabled={s.loading}><RefreshCw size={16} className={s.loading ? 'spin' : ''} /></button>
      </div>

      {s.error && (
        <div className="ts-note danger">
          <span className="msg">{s.error}</span>
          <button type="button" className="btn sm primary" onClick={() => void s.load()}>Try again</button>
        </div>
      )}

      {s.loading && s.items.length === 0 ? (
        <div className="empty-state"><span className="spinner lg" /><p>Loading requirements…</p></div>
      ) : tree && s.mode === 'outline' ? (
        <Outline tree={tree} types={types} attention={attention} />
      ) : tree ? (
        <DocumentView tree={tree} projectName={project.name} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- Outline

type Row = { kind: 'crdraft'; depth: number } | { kind: 'node'; node: ReqNode; depth: number } | { kind: 'group'; key: string; label: string } | { kind: 'draft'; depth: number } | { kind: 'task'; task: WorkItem; depth: number } | { kind: 'taskdraft'; depth: number }

function Outline({ tree, types, attention }: { tree: ReqTree; types: WorkItemType[]; attention: number }) {
  const s = useReqStore(useShallow((st) => ({ cfg: st.cfg, collapsed: st.collapsed, crDraft: st.crDraft, draft: st.draft, filter: st.filter, open: st.open, search: st.search, select: st.select, selectedId: st.selectedId, setCollapsedAll: st.setCollapsedAll, setFilter: st.setFilter, setSearch: st.setSearch, startDraft: st.startDraft, startTaskDraft: st.startTaskDraft, taskDraft: st.taskDraft, tasksOpen: st.tasksOpen, toggle: st.toggle, toggleTasks: st.toggleTasks })))
  const cfg = s.cfg!
  const me = useAppStore((st) => st.account())
  const listRef = useRef<HTMLDivElement>(null)

  // Filters keep a match's parents for context and open everything on the way.
  const visible = useMemo(() => {
    const q = s.search.trim().toLowerCase()
    if (s.filter === 'all' && !q) return null
    const weekAgo = Date.now() - 7 * 86400000
    const hit = (n: ReqNode) => {
      const f = n.item.fields
      if (s.filter === 'gaps' && !(n.gaps.length || n.bugs.length)) return false
      if (s.filter === 'changes' && n.changes.length === 0) return false
      if (s.filter === 'recent' && !(new Date(String(f['System.ChangedDate'] ?? 0)).getTime() >= weekAgo)) return false
      if (s.filter === 'mine') {
        // Mine: the requirement itself, or any of its tasks, is assigned to me.
        const isMe = (w: WorkItem) => { const a = w.fields['System.AssignedTo'] as { id?: string; displayName?: string } | undefined; return !!a && (a.id === me?.userId || a.displayName === me?.userName) }
        if (!isMe(n.item) && !n.tasks.some(isMe)) return false
      }
      if (q && !(`${idOf(n)} ${f['System.Title'] ?? ''} ${n.item.id}`.toLowerCase().includes(q))) return false
      return true
    }
    const keep = new Set<number>()
    const parentOf = (n: ReqNode) => {
      const p = n.item.fields['System.Parent']
      return typeof p === 'number' ? tree.byId.get(p) : undefined
    }
    for (const n of tree.byId.values()) {
      if (!hit(n)) continue
      for (let c: ReqNode | undefined = n; c && !keep.has(c.item.id); c = parentOf(c)) keep.add(c.item.id)
    }
    return keep
  }, [tree, s.filter, s.search, me])

  const rows = useMemo(() => {
    const out: Row[] = []
    const d = s.draft
    const add = (n: ReqNode, depth: number) => {
      if (visible && !visible.has(n.item.id)) return
      out.push({ kind: 'node', node: n, depth })
      const open = visible ? true : !s.collapsed.has(n.item.id)
      if (open) n.children.forEach((c) => add(c, depth + 1))
      if (d && d.parentId === n.item.id) out.push({ kind: 'draft', depth: depth + 1 })
      if (n.tier.level === 2 && s.tasksOpen.has(n.item.id)) n.tasks.forEach((task) => out.push({ kind: 'task', task, depth: depth + 1 }))
      if (s.taskDraft?.parentId === n.item.id) out.push({ kind: 'taskdraft', depth: depth + 1 })
      if (s.crDraft?.targetId === n.item.id) out.push({ kind: 'crdraft', depth: depth + 1 })
    }
    tree.roots.forEach((n) => add(n, 0))
    if (d && d.parentId === null) out.push({ kind: 'draft', depth: 0 })
    if (tree.orphanDis.some((n) => !visible || visible.has(n.item.id))) {
      out.push({ kind: 'group', key: 'odi', label: `${cfg.tiers[1].label} without a ${cfg.tiers[0].label}` })
      tree.orphanDis.forEach((n) => add(n, 1))
    }
    if (tree.orphanSrs.some((n) => !visible || visible.has(n.item.id))) {
      out.push({ kind: 'group', key: 'osrs', label: `${cfg.tiers[2].label} without a ${cfg.tiers[1].label}` })
      tree.orphanSrs.forEach((n) => add(n, 2))
    }
    return out
  }, [tree, visible, s.collapsed, s.draft, s.tasksOpen, s.taskDraft, s.crDraft, cfg])

  const nodeRows = rows.filter((r): r is Extract<Row, { kind: 'node' }> => r.kind === 'node')
  const parentIdOf = (n: ReqNode) => (typeof n.item.fields['System.Parent'] === 'number' && tree.byId.get(n.item.fields['System.Parent'] as number)?.tier.level === n.tier.level - 1 ? (n.item.fields['System.Parent'] as number) : null)

  const addSibling = (n: ReqNode) => s.startDraft({ parentId: parentIdOf(n), level: n.tier.level, afterId: n.item.id })
  // Under an SRS, "child" means a task.
  const addChild = (n: ReqNode) => {
    if (n.tier.level < 2) s.startDraft({ parentId: n.item.id, level: (n.tier.level + 1) as 1 | 2, afterId: null })
    else s.startTaskDraft({ parentId: n.item.id, discipline: null })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    const i = nodeRows.findIndex((r) => r.node.item.id === s.selectedId)
    const cur = i >= 0 ? nodeRows[i].node : null
    const go = (j: number) => { const r = nodeRows[Math.max(0, Math.min(nodeRows.length - 1, j))]; if (r) { s.select(r.node.item.id); scrollToRow(listRef.current, r.node.item.id) } }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i < 0 ? 0 : i - 1) }
    else if (e.key === 'ArrowRight' && cur) { e.preventDefault(); if (cur.tier.level === 2) { if (cur.tasks.length && !s.tasksOpen.has(cur.item.id)) s.toggleTasks(cur.item.id) } else if (s.collapsed.has(cur.item.id)) s.toggle(cur.item.id) }
    else if (e.key === 'ArrowLeft' && cur) {
      e.preventDefault()
      if (cur.tier.level === 2 && s.tasksOpen.has(cur.item.id)) s.toggleTasks(cur.item.id)
      else if (cur.children.length && !s.collapsed.has(cur.item.id)) s.toggle(cur.item.id)
      else { const p = parentIdOf(cur); if (p) { s.select(p); scrollToRow(listRef.current, p) } }
    }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); addSibling(cur) }
    else if (e.key === 'Tab' && cur && !e.shiftKey) { e.preventDefault(); addChild(cur) }
    else if (e.key === ' ' && cur) { e.preventDefault(); s.open(cur.item.id) }
  }

  const allParents = [...tree.byId.values()].filter((n) => n.children.length).map((n) => n.item.id)
  const anyOpen = allParents.some((id) => !s.collapsed.has(id))
  const [un] = cfg.tiers

  return (
    <>
      <div className="req-bar">
        <div className="search-box">
          <Search size={14} />
          <input value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder="Find by ID or title" onKeyDown={(e) => e.key === 'Escape' && s.setSearch('')} />
          {s.search && <button type="button" className="clear" onClick={() => s.setSearch('')}><X size={13} /></button>}
        </div>
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.v} type="button" className={s.filter === f.v ? 'on' : ''} onClick={() => s.setFilter(f.v)}>
              {f.l}{f.v === 'gaps' && attention > 0 && <span className="req-count">{attention}</span>}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn" title={anyOpen ? 'Collapse all' : 'Expand all'} onClick={() => s.setCollapsedAll(anyOpen ? allParents : [])}>
          {anyOpen ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
        </button>
        <button type="button" className="btn primary" onClick={() => s.startDraft({ parentId: null, level: 0, afterId: null })}><Plus size={14} /> New {un.label}</button>
      </div>

      <TagCleanup />
      <TypeCleanup tree={tree} />
      <div className="req-body" ref={listRef} tabIndex={0} onKeyDown={onKey}>
        {rows.length === 0 ? (
          visible ? <Empty title="Nothing matches">Try another filter or search.</Empty> : (
            <Empty icon={<ListTree size={28} />} title={`No ${un.label}s yet`} action={<button type="button" className="btn primary" onClick={() => s.startDraft({ parentId: null, level: 0, afterId: null })}><Plus size={14} /> New {un.label}</button>}>
              Start with a {un.type.name} ({un.label}), then add {cfg.tiers[1].label}s and {cfg.tiers[2].label}s under it.
            </Empty>
          )
        ) : (
          <div className="req-list" role="tree">
            {rows.map((r) =>
              r.kind === 'group' ? <div key={r.key} className="req-group">{r.label}</div>
                : r.kind === 'draft' ? <DraftRow key="draft" depth={r.depth} />
                : r.kind === 'task' ? <TaskRow key={`t${r.task.id}`} task={r.task} depth={r.depth} types={types} />
                : r.kind === 'taskdraft' ? <TaskDraftRow key="taskdraft" depth={r.depth} />
                : r.kind === 'crdraft' ? <ChangeDraftRow key="crdraft" depth={r.depth} />
                  : <NodeRow key={r.node.item.id} node={r.node} depth={r.depth} types={types} forcedOpen={!!visible} onAddChild={() => addChild(r.node)} />,
            )}
          </div>
        )}
      </div>
    </>
  )
}

function scrollToRow(root: HTMLElement | null, id: number) {
  root?.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'nearest' })
}

function NodeRow({ node, depth, types, forcedOpen, onAddChild }: { node: ReqNode; depth: number; types: WorkItemType[]; forcedOpen: boolean; onAddChild: () => void }) {
  const s = useReqStore(useShallow((st) => ({ cfg: st.cfg, collapsed: st.collapsed, open: st.open, select: st.select, selectedId: st.selectedId, setMethod: st.setMethod, startCrDraft: st.startCrDraft, tasksOpen: st.tasksOpen, toggle: st.toggle, toggleTasks: st.toggleTasks })))
  const cfg = s.cfg!
  const f = node.item.fields
  const id = node.item.id
  const isSrs = node.tier.level === 2
  const open = isSrs ? s.tasksOpen.has(id) : forcedOpen || !s.collapsed.has(id)
  const expandable = isSrs ? node.tasks.length > 0 : node.children.length > 0
  const below = cfg.tiers[node.tier.level + 1]
  const who = f['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
  const risk = cfg.riskField ? String(f[cfg.riskField.referenceName] ?? '') : ''
  const method = cfg.methodField ? String(f[cfg.methodField.referenceName] ?? '') : ''
  // Build progress comes from tasks; without tasks yet, from how many SRS are closed.
  const byTasks = node.taskTotal > 0
  const pct = byTasks ? Math.round((node.taskDone / node.taskTotal) * 100) : node.total ? Math.round((node.done / node.total) * 100) : 0
  const state = String(f['System.State'] ?? '')

  return (
    <div
      data-row={id}
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      className={`req-row l${node.tier.level} ${s.selectedId === id ? 'sel' : ''}`}
      style={{ paddingLeft: 10 + depth * 22 }}
      onClick={() => s.select(id)}
      onDoubleClick={() => s.open(id)}
    >
      <button type="button" className={`req-chev ${expandable ? '' : 'none'}`} onClick={(e) => { e.stopPropagation(); if (isSrs) s.toggleTasks(id); else if (expandable && !forcedOpen) s.toggle(id) }} tabIndex={-1} title={isSrs ? (open ? 'Hide tasks' : 'Show tasks') : undefined}>
        {expandable ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
      </button>
      <i className="req-type" style={{ background: typeColor(types, node.tier.type.name) }} title={node.tier.type.name} />
      <span className={`req-id ${idOf(node) ? '' : 'missing'}`}>{idOf(node) || `#${id}`}</span>
      <span className="req-name" title={String(f['System.Title'] ?? '')}>{String(f['System.Title'] ?? '')}</span>

      <span className="req-flags">
        {node.gaps.map((g) => <span key={g} className="req-flag warn" title={g}><AlertTriangle size={11} /> {g}</span>)}
        {node.changes.length > 0 && (
          <button type="button" className="req-flag cr" title={node.changes.map((c) => `CR #${c.id} ${c.fields['System.Title']} (${c.fields['System.State']})`).join('\n')} onClick={(e) => { e.stopPropagation(); s.open(node.changes[0].id) }}>
            <FilePen size={11} /> CR{node.changes.length > 1 ? ` ${node.changes.length}` : ''}
          </button>
        )}
        {node.bugs.length > 0 && <span className="req-flag bug" title={node.bugs.map((b) => `#${b.id} ${b.fields['System.Title']}`).join('\n')}><Bug size={11} /> {node.bugs.length}</span>}
      </span>

      {isSrs ? (
        <TaskSummary node={node} types={types} onClick={() => s.toggleTasks(id)} />
      ) : (
        <span className="req-progress" title={byTasks ? `Build: ${node.taskDone} of ${node.taskTotal} tasks done · ${node.done} of ${node.total} ${cfg.tiers[2].label} closed` : `${node.done} of ${node.total} ${cfg.tiers[2].label} closed · no tasks yet`}>
          <i><b style={{ width: `${pct}%` }} /></i>
          <span>{byTasks ? `${pct}%` : `${node.done}/${node.total}`}</span>
        </span>
      )}
      {isSrs && cfg.methodField && (
        <select
          className={`req-method ${method ? '' : 'unset'}`}
          value={method}
          title={cfg.methodField.name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => void s.setMethod(id, e.target.value)}
        >
          {!method && <option value="">Method?</option>}
          {(cfg.methodField.allowedValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {risk && <span className={`req-risk ${risk.toLowerCase()}`}>{risk}</span>}
      <span className="req-state"><i style={{ background: stateColor(types, node.tier.type.name, state) }} />{state}</span>
      <span className="req-who">{who?.displayName ? <Avatar name={who.displayName} keyName={who.uniqueName} size="sm" title={who.displayName} /> : null}</span>
      <span className="req-actions">
        <button type="button" className="icon-btn sm" title="Request a change to this (creates a Change Request that Affects it)" onClick={(e) => { e.stopPropagation(); s.select(id); s.startCrDraft({ targetId: id }) }}><FilePen size={13} /></button>
        <button type="button" className="icon-btn sm" title={below ? `Add ${below.label} under this (Tab)` : 'Add a task (Tab)'} onClick={(e) => { e.stopPropagation(); s.select(id); onAddChild() }}><Plus size={13} /></button>
        <button type="button" className="btn sm ghost" onClick={(e) => { e.stopPropagation(); s.open(id) }}>Details</button>
      </span>
    </div>
  )
}

function DraftRow({ depth }: { depth: number }) {
  const s = useReqStore(useShallow((st) => ({ cfg: st.cfg, createFromDraft: st.createFromDraft, draft: st.draft, saving: st.saving, startDraft: st.startDraft })))
  const cfg = s.cfg!
  const tier = cfg.tiers[s.draft!.level]
  const [reqId, setReqId] = useState('')
  const [title, setTitle] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const idRef = useRef<HTMLInputElement>(null)
  useEffect(() => { (tier.idField ? idRef : titleRef).current?.focus() }, [tier.idField])

  const save = async () => {
    if (!title.trim()) { titleRef.current?.focus(); return }
    if (await s.createFromDraft(title, reqId)) {
      // Ready for the next one at the same level.
      setReqId(''); setTitle('')
      ;(tier.idField ? idRef : titleRef).current?.focus()
    }
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void save() }
    if (e.key === 'Escape') { e.preventDefault(); s.startDraft(null) }
  }
  return (
    <div className="req-row draft" style={{ paddingLeft: 10 + depth * 22 }}>
      <span className="req-chev none" />
      <span className="req-draft-tag">New {tier.label}</span>
      {tier.idField && <input ref={idRef} className="input req-draft-id" value={reqId} onChange={(e) => setReqId(e.target.value)} onKeyDown={key} placeholder={tier.idField.name} spellCheck={false} />}
      <input ref={titleRef} className="input req-draft-title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={key} placeholder={`${tier.type.name} title — Enter to add, Esc to stop`} />
      <button type="button" className="btn sm primary" disabled={s.saving || !title.trim()} onClick={() => void save()}>{s.saving ? 'Adding…' : 'Add'}</button>
      <button type="button" className="icon-btn sm" title="Stop adding (Esc)" onClick={() => s.startDraft(null)}><X size={14} /></button>
    </div>
  )
}

// ---------------------------------------------------------------- Tasks

const MARK: Record<string, string> = { done: '✓', active: '◐', todo: '○' }

/** On an SRS row: "Tasks 1/3" and one mark per discipline (FE ✓ BE ◐ QA ○). */
function TaskSummary({ node, types, onClick }: { node: ReqNode; types: WorkItemType[]; onClick: () => void }) {
  if (node.tasks.length === 0) return <span className="req-tasks none" title="No tasks under this requirement yet">No tasks</span>
  const parts = disciplineSummary(types, node.tasks)
  const all = node.taskDone === node.taskTotal
  return (
    <button type="button" className={`req-tasks ${all ? 'done' : ''}`} onClick={(e) => { e.stopPropagation(); onClick() }}
      title={parts.map((p) => `${p.d}: ${p.done} of ${p.total} done`).join('\n')}>
      <span className="n">Tasks {node.taskDone}/{node.taskTotal}</span>
      {parts.map((p) => <span key={p.d} className={`disc ${p.state}`}>{p.d} {MARK[p.state]}</span>)}
    </button>
  )
}

function TaskRow({ task, depth, types }: { task: WorkItem; depth: number; types: WorkItemType[] }) {
  const s = useReqStore(useShallow((st) => ({ open: st.open })))
  const f = task.fields
  const done = isTaskDone(types, task)
  const { d } = disciplineOf(task)
  const who = f['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
  const left = f['Microsoft.VSTS.Scheduling.RemainingWork']
  const state = String(f['System.State'] ?? '')
  return (
    <div className={`req-row task ${done ? 'done' : ''}`} style={{ paddingLeft: 10 + depth * 22 }} onDoubleClick={() => s.open(task.id)}>
      <span className="req-chev none" />
      <span className="req-check">{done ? <CheckSquare size={14} /> : <Square size={14} />}</span>
      {d ? <span className={`disc-tag ${d.toLowerCase()}`}>{d}</span> : <span className="disc-tag none">—</span>}
      <span className="req-name" title={String(f['System.Title'] ?? '')}>{titleWithoutPrefix(String(f['System.Title'] ?? ''))}</span>
      <span className="req-task-who">{who?.displayName ? <><Avatar name={who.displayName} keyName={who.uniqueName} size="sm" /> {who.displayName.split(' ')[0]}</> : <span className="faint">Unassigned</span>}</span>
      <span className="req-state"><i style={{ background: stateColor(types, 'Task', state) }} />{state}</span>
      <span className="req-left">{!done && typeof left === 'number' && left > 0 ? `${left}h left` : ''}</span>
      <span className="req-actions"><button type="button" className="btn sm ghost" onClick={() => s.open(task.id)}>Details</button></span>
    </div>
  )
}

function TaskDraftRow({ depth }: { depth: number }) {
  const s = useReqStore(useShallow((st) => ({ createTask: st.createTask, saving: st.saving, startTaskDraft: st.startTaskDraft, taskDraft: st.taskDraft })))
  const [title, setTitle] = useState('')
  const [disc, setDisc] = useState<Discipline | null>(s.taskDraft?.discipline ?? null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const save = async () => {
    if (!title.trim()) return
    if (await s.createTask(title, disc)) { setTitle(''); ref.current?.focus() }
  }
  return (
    <div className="req-row draft task" style={{ paddingLeft: 10 + depth * 22 }}>
      <span className="req-chev none" />
      <span className="req-draft-tag">New task</span>
      <div className="segmented small">
        {DISCIPLINES.map((d) => <button key={d} type="button" className={disc === d ? 'on' : ''} onClick={() => { setDisc(disc === d ? null : d); ref.current?.focus() }}>{d}</button>)}
      </div>
      <input ref={ref} className="input req-draft-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title — Enter to add, Esc to stop"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } if (e.key === 'Escape') { e.preventDefault(); s.startTaskDraft(null) } }} />
      <button type="button" className="btn sm primary" disabled={s.saving || !title.trim()} onClick={() => void save()}>{s.saving ? 'Adding…' : 'Add'}</button>
      <button type="button" className="icon-btn sm" title="Stop adding (Esc)" onClick={() => s.startTaskDraft(null)}><X size={14} /></button>
    </div>
  )
}

function ChangeDraftRow({ depth }: { depth: number }) {
  const s = useReqStore(useShallow((st) => ({ crDraft: st.crDraft, createChange: st.createChange, items: st.items, saving: st.saving, startCrDraft: st.startCrDraft })))
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const target = s.items.find((i) => i.id === s.crDraft?.targetId)
  const save = async () => { if (title.trim()) await s.createChange(title) }
  return (
    <div className="req-row draft cr" style={{ paddingLeft: 10 + depth * 22 }}>
      <span className="req-chev none" />
      <span className="req-draft-tag"><FilePen size={12} /> Change request</span>
      <input ref={ref} className="input req-draft-title" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={`What should change in “${String(target?.fields['System.Title'] ?? '')}”? — Enter to create`}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } if (e.key === 'Escape') { e.preventDefault(); s.startCrDraft(null) } }} />
      <button type="button" className="btn sm primary" disabled={s.saving || !title.trim()} onClick={() => void save()}>{s.saving ? 'Creating…' : 'Create'}</button>
      <button type="button" className="icon-btn sm" title="Cancel (Esc)" onClick={() => s.startCrDraft(null)}><X size={14} /></button>
    </div>
  )
}

/** Change requests and issues that are really tasks, offered for retyping (or, for real CRs under an SRS, re-linking with Affects). */
function TypeCleanup({ tree }: { tree: ReqTree }) {
  const s = useReqStore(useShallow((st) => ({ changes: st.changes, issues: st.issues })))
  const toast = useUiStore((u) => u.toast)
  const [open, setOpen] = useState(false)
  const srsIds = useMemo(() => new Set([...tree.byId.values()].filter((n) => n.tier.level === 2).map((n) => n.item.id)), [tree])
  const list = useMemo(() => [...s.changes, ...s.issues].map((item) => ({ item, why: looksLikeTask(item, srsIds) })).filter((x): x is { item: WorkItem; why: string } => !!x.why), [s.changes, s.issues, srsIds])
  if (list.length === 0) return null
  return (
    <>
      <div className="ts-note req-note">
        <FilePen size={15} />
        <span className="msg">{list.length} change request{list.length > 1 ? 's' : ''}/issue{list.length > 1 ? 's' : ''} look like tasks (hours, FE/BE mark, or placed under a requirement).</span>
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>Review…</button>
      </div>
      {open && <TypeReviewSheet list={list} srsIds={srsIds} onClose={() => setOpen(false)} onDone={(n) => toast({ kind: 'success', title: `${n} item${n === 1 ? '' : 's'} updated` })} />}
    </>
  )
}

type ReviewAction = 'task' | 'affects' | 'skip'

function TypeReviewSheet({ list, srsIds, onClose, onDone }: { list: { item: WorkItem; why: string }[]; srsIds: Set<number>; onClose: () => void; onDone: (n: number) => void }) {
  const s = useReqStore(useShallow((st) => ({ applyReview: st.applyReview })))
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<Record<number, ReviewAction>>(() => Object.fromEntries(list.map(({ item }) => [item.id, 'task'])))
  const count = Object.values(plan).filter((a) => a !== 'skip').length
  const apply = async () => {
    setBusy(true)
    const n = await s.applyReview(list.filter(({ item }) => plan[item.id] !== 'skip').map(({ item }) => ({ item, action: plan[item.id] as 'task' | 'affects' })))
    setBusy(false)
    onDone(n)
    onClose()
  }
  return (
    <Sheet title="Change requests and issues that look like tasks" onClose={onClose} size="wide"
      footer={<><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || count === 0} onClick={() => void apply()}>{busy ? 'Updating…' : `Update ${count}`}</button></>}>
      <p className="faint" style={{ marginTop: 0 }}>Pick what each one really is. <b>Task</b> changes its type (title, assignee and parent stay; an [FE] prefix becomes a tag). <b>Keep as CR</b> removes it from under the requirement and links it with <i>Affects</i> instead.</p>
      <table className="review-table">
        <thead><tr><th>Item</th><th>Why it looks like a task</th><th>Make it</th></tr></thead>
        <tbody>
          {list.map(({ item, why }) => {
            const isCr = item.fields['System.WorkItemType'] === 'Change Request'
            const p = parentIdOfItem(item)
            const canAffect = isCr && p !== null && srsIds.has(p)
            return (
              <tr key={item.id}>
                <td><span className="faint">{String(item.fields['System.WorkItemType'])} #{item.id}</span><div>{String(item.fields['System.Title'] ?? '')}</div></td>
                <td className="faint">{why}</td>
                <td>
                  <select className="input" value={plan[item.id]} onChange={(e) => setPlan((x) => ({ ...x, [item.id]: e.target.value as ReviewAction }))}>
                    <option value="task">Task</option>
                    {canAffect && <option value="affects">Keep as CR, link with Affects</option>}
                    <option value="skip">Leave as it is</option>
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Sheet>
  )
}

/** Offers to move "[FE] …" title prefixes into tags, after showing what will change. */
function TagCleanup() {
  const s = useReqStore(useShallow((st) => ({ tagPrefixed: st.tagPrefixed, tasks: st.tasks })))
  const toast = useUiStore((u) => u.toast)
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => s.tasks.filter((t) => disciplineOf(t).fromPrefix), [s.tasks])
  if (list.length === 0) return null
  const run = async () => {
    const sample = list.slice(0, 8).map((t) => `#${t.id}  “${titleWithoutPrefix(String(t.fields['System.Title'] ?? ''))}”  + tag ${disciplineOf(t).d}`).join('\n')
    const more = list.length > 8 ? `\n…and ${list.length - 8} more` : ''
    const ok = await confirmAsync(`Move the [FE]/[BE]/[QA] title prefix of ${list.length} task${list.length > 1 ? 's' : ''} into a tag?\n\nNew title and tag:\n${sample}${more}`, { okLabel: `Update ${list.length}` })
    if (!ok) return
    setBusy(true)
    const n = await s.tagPrefixed(list)
    setBusy(false)
    toast({ kind: 'success', title: `${n} task${n === 1 ? '' : 's'} now tagged` })
  }
  return (
    <div className="ts-note req-note">
      <Tags size={15} />
      <span className="msg">{list.length} task{list.length > 1 ? 's' : ''} still use <b>[FE]</b>/<b>[BE]</b>/<b>[QA]</b> in the title. Tags work better for filtering in Azure DevOps.</span>
      <button type="button" className="btn sm" disabled={busy} onClick={() => void run()}>{busy ? 'Updating…' : 'Move to tags…'}</button>
    </div>
  )
}

// ---------------------------------------------------------------- Document

function DocumentView({ tree, projectName }: { tree: ReqTree; projectName: string }) {
  const s = useReqStore(useShallow((st) => ({ cfg: st.cfg, open: st.open })))
  const cfg = s.cfg!
  const org = useAppStore((st) => st.activeOrg)
  const toast = useUiStore((u) => u.toast)
  const [rootId, setRootId] = useState<number | null>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => buildDocument(cfg, tree, { rootId, projectName }), [cfg, tree, rootId, projectName])

  useEffect(() => {
    if (!docRef.current) return
    docRef.current.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-id'] })
    if (org) hydrateImages(docRef.current, org)
  }, [html, org])

  const title = `${projectName} – Software Requirements${rootId ? ` – ${idOf(tree.byId.get(rootId)!) || ''}` : ''}`

  // Copies what is on screen (images included) as formatted text; Word keeps headings and tables.
  const copy = () => {
    const el = docRef.current
    if (!el) return
    const ok = copyRichText(el)
    toast(ok ? { kind: 'success', title: 'Copied', detail: 'Paste into Word or your SRS template.' } : { kind: 'error', title: 'Could not copy' })
  }

  const exportHtml = async () => {
    const path = await api().pickSavePath(`${title}.html`, { name: 'Web page', extensions: ['html'] })
    if (!path) return
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${DOC_EXPORT_CSS}</style></head><body><h1>${title}</h1>${docRef.current?.innerHTML ?? ''}</body></html>`
    await api().writeTextFile(path, page)
    toast({ kind: 'success', title: 'Exported', detail: path })
  }
  const exportCsv = async () => {
    const path = await api().pickSavePath(`${title}.csv`)
    if (!path) return
    await api().writeTextFile(path, buildCsv(cfg, tree))
    toast({ kind: 'success', title: 'Exported', detail: path })
  }

  const [un] = cfg.tiers
  return (
    <>
      <div className="req-bar">
        <select className="input" style={{ width: 280 }} value={rootId ?? ''} onChange={(e) => setRootId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Whole project</option>
          {tree.roots.map((r) => <option key={r.item.id} value={r.item.id}>{idOf(r) || `#${r.item.id}`} · {String(r.item.fields['System.Title'] ?? '')}</option>)}
        </select>
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>One {un.label} or the whole project</span>
        <span className="grow" />
        <button type="button" className="btn primary" onClick={copy}><Copy size={14} /> Copy for Word</button>
        <button type="button" className="btn" onClick={() => void exportHtml()}><Download size={14} /> HTML</button>
        <button type="button" className="btn" onClick={() => void exportCsv()}><Download size={14} /> CSV</button>
      </div>
      <div className="req-body doc">
        <article className="req-doc" onDoubleClick={(e) => { const id = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id'); if (id) s.open(Number(id)) }}>
          <h1>{title}</h1>
          <div ref={docRef} />
        </article>
        <div className="req-hint">Double-click a heading or row to open it · Copy for Word keeps headings, tables and images</div>
      </div>
    </>
  )
}


