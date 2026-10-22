import { ChevronDown, GitPullRequest, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { Empty } from '@/components/ui/Empty'
import { relativeTime } from '@/lib/format'
import { inEditable } from '@/lib/shortcuts'
import { branchName, type PullRequest } from '@/lib/pr/types'
import { useAppStore } from '@/store/useAppStore'
import { usePrStore, waitsOnMe, type PrTab } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { PrDetailPane } from './PrDetailPane'

const tabs: { id: PrTab; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'mine', label: 'Authored' },
  { id: 'active', label: 'Active' },
  { id: 'closed', label: 'Closed' },
]

export function PrView() {
  const projects = useAppStore((s) => s.projects)
  const me = useAppStore((s) => s.account())
  const s = usePrStore(useShallow((st) => ({ close: st.close, init: st.init, list: st.list, listError: st.listError, listLoading: st.listLoading, listWarning: st.listWarning, loadList: st.loadList, open: st.open, prItems: st.prItems, repoFilter: st.repoFilter, repos: st.repos, scope: st.scope, scopeWaiting: st.scopeWaiting, search: st.search, selected: st.selected, setRepoFilter: st.setRepoFilter, setScope: st.setScope, setSearch: st.setSearch, setTab: st.setTab, tab: st.tab })))
  const openSheet = useUiStore((s) => s.openSheet)
  const [repoOpen, setRepoOpen] = useState(false)
  const repoBtn = useRef<HTMLButtonElement>(null)
  const [projOpen, setProjOpen] = useState(false)
  const projBtn = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (projects.length > 0 && s.list.length === 0 && !s.listLoading) void s.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length])

  // Escape closes the open pull request, unless something on top of it (a sheet, a menu, a text box) wants it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || inEditable(e.target) || useUiStore.getState().sheet) return
      if (usePrStore.getState().selected) usePrStore.getState().close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    const q = s.search.trim().toLowerCase()
    if (!q) return s.list
    return s.list.filter((p) => p.title.toLowerCase().includes(q) || String(p.pullRequestId).includes(q) || p.createdBy.displayName.toLowerCase().includes(q) || branchName(p.sourceRefName).toLowerCase().includes(q))
  }, [s.list, s.search])

  const groups = useMemo(() => {
    if (s.scope !== 'all') return [[s.scope, filtered] as const]
    const m = new Map<string, PullRequest[]>()
    for (const p of filtered) { const k = p.repository.project?.name ?? 'Other'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(p) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, s.scope])
  const scopeLabel = s.scope === 'all' ? 'All projects' : projects.find((p) => p.id === s.scope)?.name ?? 'Project'

  return (
    <div className="pr">
      <aside className="pr-list">
        <div className="pr-list-head">
          <button ref={projBtn} type="button" className="pr-scope" onClick={() => setProjOpen(true)}>
            <span className="txt">{scopeLabel}</span><ChevronDown size={14} className="faint" />
          </button>
          <Dropdown anchor={projBtn.current} open={projOpen} onClose={() => setProjOpen(false)} searchable={projects.length > 8} width={280} value={s.scope}
            options={[{ value: 'all', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name, group: 'Projects' }))]} onSelect={(v) => s.setScope(v)} />
          <div className="segmented small">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={s.tab === t.id ? 'on' : ''} onClick={() => s.setTab(t.id)}>
                {t.label}{t.id === 'review' && s.scopeWaiting > 0 && <span className="badge" title="Waiting on your vote">{s.scopeWaiting}</span>}
              </button>
            ))}
          </div>
          <div className="pr-list-tools">
            <div className="search-box" style={{ width: 'auto', flex: 1 }}>
              <Search size={14} />
              <input value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder="Filter" />
              {s.search && <button type="button" className="clear" onClick={() => s.setSearch('')}><X size={13} /></button>}
            </div>
            <button ref={repoBtn} type="button" className={`btn sm ${s.repoFilter ? 'on' : ''}`} onClick={() => setRepoOpen(true)} title="Repository">
              {s.repoFilter ? s.repos.find((r) => r.id === s.repoFilter)?.name ?? 'Repo' : 'All repos'}
            </button>
            <Dropdown anchor={repoBtn.current} open={repoOpen} onClose={() => setRepoOpen(false)} options={[{ value: '', label: 'All repositories' }, ...s.repos.map((r) => ({ value: r.id, label: r.name }))]} value={s.repoFilter ?? ''} searchable={s.repos.length > 8} width={260} onSelect={(v) => s.setRepoFilter(v || null)} />
            <button type="button" className="icon-btn" title="Refresh" onClick={() => void s.loadList()} disabled={s.listLoading}><RefreshCw size={15} className={s.listLoading ? 'spin' : ''} /></button>
            <button type="button" className="icon-btn" title="New pull request" onClick={() => openSheet('new-pr')}><Plus size={16} /></button>
          </div>
        </div>
        <div className="pr-list-body">
          {s.listLoading && s.list.length === 0 && <div className="empty-state"><span className="spinner" /></div>}
          {s.listError && <div className="ts-note danger" style={{ margin: 8 }}><span className="msg">{s.listError}</span></div>}
          {!s.listError && s.listWarning && <div className="ts-note" style={{ margin: 8 }}><span className="msg">{s.listWarning}</span></div>}
          {!s.listLoading && filtered.length === 0 && !s.listError && (
            <div className="empty-state" style={{ padding: 24 }}><h3 style={{ fontSize: 'var(--fs-md)' }}>{s.tab === 'review' ? 'Nothing waiting for you' : 'No pull requests'}</h3></div>
          )}
          {groups.map(([name, list]) => (
            <div key={name}>
              {s.scope === 'all' && (
                <button type="button" className={`pr-group ${collapsed.has(name) ? 'collapsed' : ''}`} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(name)) n.delete(name); else n.add(name); return n })}>
                  <ChevronDown size={14} /> {name} <span className="faint">· {list.length}</span>
                </button>
              )}
              {!collapsed.has(name) && list.map((p) => <PrRow key={`${p.repository.id}:${p.pullRequestId}`} pr={p} meId={me?.userId} items={s.prItems[`${p.repository.id}:${p.pullRequestId}`]} selected={s.selected?.prId === p.pullRequestId && s.selected.repoId === p.repository.id} onOpen={() => { if (s.selected?.prId === p.pullRequestId && s.selected.repoId === p.repository.id) s.close(); else void s.open(p) }} />)}
            </div>
          ))}
        </div>
      </aside>
      <section className="pr-detail">
        {s.selected ? <PrDetailPane /> : (
          <Empty icon={<GitPullRequest size={40} strokeWidth={1.2} />} title="Select a pull request">Review the diff, comment on lines, vote, and complete it, all from here.</Empty>
        )}
      </section>
    </div>
  )
}

function PrRow({ pr, meId, items, selected, onOpen }: { pr: PullRequest; meId?: string; items?: number[]; selected: boolean; onOpen: () => void }) {
  const approvals = pr.reviewers.filter((r) => r.vote >= 5).length
  const blocks = pr.reviewers.filter((r) => r.vote < 0).length
  return (
    <button type="button" className={`pr-row ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div className="pr-row-top">
        <span className={`pr-dot ${pr.status} ${pr.isDraft ? 'draft' : ''}`} />
        <span className="pr-row-title">{pr.title}</span>
      </div>
      <div className="pr-row-meta">
        <Avatar name={pr.createdBy.displayName} keyName={pr.createdBy.uniqueName} size="sm" />
        <span className="faint">!{pr.pullRequestId} · {pr.repository.name} · {relativeTime(pr.creationDate)}</span>
        <span className="grow" />
        {items && items.length > 0 && <span className="pr-row-items" title={`Linked work item${items.length > 1 ? 's' : ''}`}>{items.slice(0, 2).map((i) => `#${i}`).join(' ')}{items.length > 2 ? ` +${items.length - 2}` : ''}</span>}
        {pr.status === 'abandoned' && <span className="pr-chip">Abandoned</span>}
        {pr.isDraft && <span className="pr-chip">Draft</span>}
        {pr.mergeStatus === 'conflicts' && <span className="pr-chip bad">Conflicts</span>}
        {blocks > 0 && <span className="pr-chip bad">{blocks} blocking</span>}
        {approvals > 0 && <span className="pr-chip ok">{approvals} ✓</span>}
        {pr.status === 'active' && waitsOnMe(pr, meId) && <span className="pr-chip warn">Your review</span>}
      </div>
    </button>
  )
}
