import { AlertTriangle, Ban, Bug, ChevronDown, OctagonAlert, ChevronRight, RefreshCw, Search, Users, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Empty } from '@/components/ui/Empty'
import { relativeTime, stateColor } from '@/lib/format'
import { DISCIPLINES, blockedBy, buildTree, disciplineOf, idOf, isTaskDone, titleWithoutPrefix, type Discipline, type ReqNode } from '@/lib/requirements'
import type { WorkItem, WorkItemType } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { ensureReqLoaded, useReqStore } from '@/store/useReqStore'

/** Active work untouched this long is flagged as possibly stuck. */
const STALE_DAYS = 5
const DAY = 86400000

type Person = { key: string; name: string; uniqueName?: string; active: WorkItem[]; todo: WorkItem[]; doneWeek: WorkItem[]; hoursLeft: number; stale: number; blocked: number; disciplines: Set<Discipline> }

const isBug = (w: WorkItem) => w.fields['System.WorkItemType'] === 'Bug'
const started = (w: WorkItem) => !/^(new|proposed|to do)$/i.test(String(w.fields['System.State']))
const changedAt = (w: WorkItem) => new Date(String(w.fields['System.ChangedDate'] ?? 0)).getTime()
const isStale = (w: WorkItem) => started(w) && Date.now() - changedAt(w) > STALE_DAYS * DAY

/** Who is working on what in this project: open tasks and bugs per person, with the requirement each one serves. */
export function TeamView() {
  const project = useAppStore((s) => s.selectedProject)
  const me = useAppStore((s) => s.account())
  const ctx = useBoardStore((s) => s.ctx)
  const s = useReqStore(useShallow((st) => ({ bugs: st.bugs, cfg: st.cfg, error: st.error, issues: st.issues, items: st.items, load: st.load, loading: st.loading, tasks: st.tasks })))
  const [disc, setDisc] = useState<Discipline | 'all'>('all')
  const [q, setQ] = useState('')
  const [folded, setFolded] = useState<Set<string>>(new Set())

  useEffect(() => { if (project && ctx) ensureReqLoaded(project.name, ctx) }, [project, ctx])

  const types = ctx?.workItemTypes ?? []
  const tree = useMemo(() => (s.cfg ? buildTree(s.cfg, types, s.items, s.bugs, s.tasks) : null), [s.cfg, types, s.items, s.bugs, s.tasks])
  const blocked = useMemo(() => blockedBy(s.issues), [s.issues])

  const people = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY
    const map = new Map<string, Person>()
    const work = [...s.tasks, ...s.bugs].filter((w) => disc === 'all' || (!isBug(w) && disciplineOf(w).d === disc))
    for (const w of work) {
      const a = w.fields['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
      const key = a?.uniqueName || a?.displayName || ''
      if (!map.has(key)) map.set(key, { key, name: a?.displayName ?? 'Unassigned', uniqueName: a?.uniqueName, active: [], todo: [], doneWeek: [], hoursLeft: 0, stale: 0, blocked: 0, disciplines: new Set() })
      const p = map.get(key)!
      const d = disciplineOf(w).d
      if (d) p.disciplines.add(d)
      if (isTaskDone(types, w)) {
        if (changedAt(w) >= weekAgo) p.doneWeek.push(w)
        continue
      }
      ;(started(w) ? p.active : p.todo).push(w)
      const left = w.fields['Microsoft.VSTS.Scheduling.RemainingWork']
      if (typeof left === 'number') p.hoursLeft += left
      if (isStale(w)) p.stale++
      if (blocked.has(w.id)) p.blocked++
    }
    const t = q.trim().toLowerCase()
    return [...map.values()]
      .filter((p) => p.active.length + p.todo.length + p.doneWeek.length > 0)
      .filter((p) => !t || p.name.toLowerCase().includes(t))
      // Busiest first; unassigned work last so it is not mistaken for a person.
      .sort((a, b) => Number(!a.key) - Number(!b.key) || (b.active.length + b.todo.length) - (a.active.length + a.todo.length) || a.name.localeCompare(b.name))
  }, [s.tasks, s.bugs, types, disc, q, blocked])

  if (!project) return <Empty title="Choose a project">Pick a project in the sidebar to see its team.</Empty>
  if (!ctx) return <div className="empty-state"><span className="spinner lg" /><p>Loading {project.name}…</p></div>

  const totals = people.reduce((a, p) => ({ open: a.open + p.active.length + p.todo.length, hours: a.hours + p.hoursLeft, stale: a.stale + p.stale, done: a.done + p.doneWeek.length }), { open: 0, hours: 0, stale: 0, done: 0 })
  const toggle = (k: string) => setFolded((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="req team">
      <div className="req-head">
        <div className="req-title">
          <strong>Team</strong>
          <span className="faint">Open tasks and bugs in {project.name}, by person</span>
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn" title="Reload" onClick={() => void s.load()} disabled={s.loading}><RefreshCw size={16} className={s.loading ? 'spin' : ''} /></button>
      </div>

      <div className="team-stats">
        <div><b>{people.filter((p) => p.key).length}</b><span>people</span></div>
        <div><b>{totals.open}</b><span>open</span></div>
        <div><b>{Math.round(totals.hours * 10) / 10}h</b><span>left</span></div>
        <div className={totals.stale ? 'warn' : ''}><b>{totals.stale}</b><span>no update {STALE_DAYS}+ days</span></div>
        <div className="ok"><b>{totals.done}</b><span>done this week</span></div>
      </div>

      <div className="req-bar">
        <div className="search-box">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
          {q && <button type="button" className="clear" onClick={() => setQ('')}><X size={13} /></button>}
        </div>
        <div className="segmented">
          <button type="button" className={disc === 'all' ? 'on' : ''} onClick={() => setDisc('all')}>Everyone</button>
          {DISCIPLINES.map((d) => <button key={d} type="button" className={disc === d ? 'on' : ''} onClick={() => setDisc(d)}>{d}</button>)}
        </div>
        <span className="grow" />
        <button type="button" className="btn sm ghost" onClick={() => setFolded(folded.size ? new Set() : new Set(people.map((p) => p.key)))}>{folded.size ? 'Expand all' : 'Collapse all'}</button>
      </div>

      {s.issues.length > 0 && <IssueStrip issues={s.issues} />}

      {s.error && <div className="ts-note danger"><span className="msg">{s.error}</span><button type="button" className="btn sm primary" onClick={() => void s.load()}>Try again</button></div>}

      <div className="req-body">
        {s.loading && s.tasks.length === 0 ? (
          <div className="empty-state"><span className="spinner lg" /><p>Loading tasks…</p></div>
        ) : people.length === 0 ? (
          <Empty icon={<Users size={28} />} title="No open work">{disc === 'all' ? 'Nobody has open tasks or bugs in this project.' : `No ${disc} tasks.`}</Empty>
        ) : (
          <div className="team-list">
            {people.map((p) => {
              const open = !folded.has(p.key)
              const isMe = !!me && (p.uniqueName === me.userName || p.name === me.userName)
              return (
                <section key={p.key || 'unassigned'} className={`team-person ${p.key ? '' : 'unassigned'}`}>
                  <button type="button" className="team-person-head" onClick={() => toggle(p.key)}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {p.key ? <Avatar name={p.name} keyName={p.uniqueName} /> : <span className="team-nobody"><Users size={15} /></span>}
                    <span className="nm">{p.name}{isMe && <span className="faint"> · you</span>}</span>
                    <span className="team-discs">{[...p.disciplines].map((d) => <span key={d} className={`disc-tag ${d.toLowerCase()}`}>{d}</span>)}</span>
                    <span className="grow" />
                    <span className={`team-chip ${p.active.length ? 'active' : ''}`}>{p.active.length} in progress</span>
                    <span className="team-chip">{p.todo.length} to do</span>
                    {p.hoursLeft > 0 && <span className="team-chip">{Math.round(p.hoursLeft * 10) / 10}h left</span>}
                    {p.blocked > 0 && <span className="team-chip danger"><Ban size={11} /> {p.blocked} blocked</span>}
                    {p.stale > 0 && <span className="team-chip warn"><AlertTriangle size={11} /> {p.stale} stuck?</span>}
                    {p.doneWeek.length > 0 && <span className="team-chip ok">✓ {p.doneWeek.length} this week</span>}
                  </button>
                  {open && (
                    <div className="team-work">
                      {[...p.active, ...p.todo].map((w) => <WorkRow key={w.id} w={w} types={types} srs={srsFor(tree?.byId, w)} blockers={blocked.get(w.id) ?? []} />)}
                      {p.active.length + p.todo.length === 0 && <div className="team-empty">Nothing open. {p.doneWeek.length} finished this week.</div>}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
        <div className="req-hint">Grouped by who it is assigned to · “Stuck?” means in progress with no change for {STALE_DAYS} days · double-click a row for details</div>
      </div>
    </div>
  )
}

/** The requirement a task or bug sits under, if its parent is one of the project's SRS. */
function srsFor(byId: Map<number, ReqNode> | undefined, w: WorkItem): ReqNode | null {
  const p = w.fields['System.Parent']
  const n = typeof p === 'number' ? byId?.get(p) : undefined
  return n && n.tier.level === 2 ? n : null
}

/** Open issues: problems in the way of the work, separate from the work itself. */
function IssueStrip({ issues }: { issues: WorkItem[] }) {
  const s = useReqStore(useShallow((st) => ({ open: st.open })))
  return (
    <div className="team-issues">
      <div className="team-issues-h"><OctagonAlert size={14} /> Open issues · {issues.length}</div>
      <div className="team-issues-list">
        {issues.map((i) => {
          const who = i.fields['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
          const blocks = blockedBy([i]).size
          return (
            <button key={i.id} type="button" className="team-issue" onClick={() => s.open(i.id)} title={String(i.fields['System.Title'] ?? '')}>
              <span className="t">{String(i.fields['System.Title'] ?? '')}</span>
              <span className="m">
                {who?.displayName ? <><Avatar name={who.displayName} keyName={who.uniqueName} size="sm" /> {who.displayName.split(' ')[0]}</> : 'No owner'}
                <span>· open {relativeTime(String(i.fields['System.CreatedDate'] ?? '')).replace(/ ago$/, '')}</span>
                {blocks > 0 && <span className="b">· blocks {blocks}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WorkRow({ w, types, srs, blockers }: { w: WorkItem; types: WorkItemType[]; srs: ReqNode | null; blockers: WorkItem[] }) {
  const s = useReqStore(useShallow((st) => ({ open: st.open })))
  const f = w.fields
  const bug = isBug(w)
  const { d } = disciplineOf(w)
  const state = String(f['System.State'] ?? '')
  const left = f['Microsoft.VSTS.Scheduling.RemainingWork']
  const stale = isStale(w)
  return (
    <div className={`team-row ${started(w) ? 'active' : ''}`} onDoubleClick={() => s.open(w.id)}>
      {bug ? <span className="disc-tag bug"><Bug size={11} /></span> : d ? <span className={`disc-tag ${d.toLowerCase()}`}>{d}</span> : <span className="disc-tag none">—</span>}
      <span className="team-title" title={String(f['System.Title'] ?? '')}>{titleWithoutPrefix(String(f['System.Title'] ?? ''))}</span>
      {blockers.length > 0 && (
        <button type="button" className="team-blocked" title={blockers.map((b) => `Issue #${b.id} ${b.fields['System.Title']}`).join('\n')} onClick={(e) => { e.stopPropagation(); s.open(blockers[0].id) }}>
          <Ban size={11} /> Blocked
        </button>
      )}
      {srs ? (
        <button type="button" className="team-srs" title={String(srs.item.fields['System.Title'] ?? '')} onClick={(e) => { e.stopPropagation(); s.open(srs.item.id) }}>{idOf(srs) || `#${srs.item.id}`}</button>
      ) : <span className="team-srs none" title="Not under a requirement">No SRS</span>}
      <span className="req-state"><i style={{ background: stateColor(types, String(f['System.WorkItemType'] ?? ''), state) }} />{state}</span>
      <span className="req-left">{typeof left === 'number' && left > 0 ? `${left}h` : ''}</span>
      <span className={`team-when ${stale ? 'warn' : ''}`} title="Last changed">{stale && <AlertTriangle size={11} />} {relativeTime(String(f['System.ChangedDate'] ?? ''))}</span>
      <span className="req-actions"><button type="button" className="btn sm ghost" onClick={() => s.open(w.id)}>Details</button></span>
    </div>
  )
}
