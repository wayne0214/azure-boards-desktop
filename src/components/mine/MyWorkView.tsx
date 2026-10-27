import { CheckCircle2, ChevronDown, GitPullRequest, Inbox, MessageSquare, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { itemUrl, relativeTime, typeColor } from '@/lib/format'
import type { PullRequest } from '@/lib/pr/types'
import type { WorkItem } from '@/lib/types'
import { errorMessage } from '@/lib/types'
import { Empty } from '@/components/ui/Empty'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { isFinished, isShown, isToVerify, isUnseen, isWaitingOnReporter, matchesSearch, planningCount, typeOf, useMyWorkStore, type TypesByProject } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { WikiUpdatesStrip } from '@/components/wiki/WikiUpdates'
import { useWikiStore } from '@/store/useWikiStore'

const COLS = 8

type Section = { key: 'active' | 'verify'; title: string; hint: string; projects: [string, WorkItem[]][] }

const priorityOf = (it: WorkItem) => { const p = it.fields['Microsoft.VSTS.Common.Priority']; return typeof p === 'number' ? p : 9 }
const changedOf = (it: WorkItem) => String(it.fields['System.ChangedDate'] ?? '')

/** Everything assigned to the signed-in user across the organization, plus resolved items waiting to be verified. */
export function MyWorkView() {
  const org = useAppStore((s) => s.activeOrg)
  const projects = useAppStore((s) => s.projects)
  const account = useAppStore((s) => s.account())
  const selectProject = useAppStore((s) => s.selectProject)
  const selectedProject = useAppStore((s) => s.selectedProject)
  const setView = useUiStore((s) => s.setView)
  const toast = useUiStore((s) => s.toast)
  const types = useMyWorkStore((s) => s.types)
  const search = useMyWorkStore((s) => s.search)
  const planning = useMyWorkStore((s) => s.planning)
  const showPlanning = useMyWorkStore((s) => s.showPlanning)
  const highlightSince = useMyWorkStore((s) => s.highlightSince)
  const involved = usePrStore((s) => s.involved)
  const prItems = usePrStore((s) => s.prItems)
  const openItem = useBoardStore((s) => s.openItem)
  const selectedId = useBoardStore((s) => s.selectedId)
  const items = useMyWorkStore((s) => s.items)
  const error = useMyWorkStore((s) => s.error)
  const loading = useMyWorkStore((s) => s.loading)
  const load = useMyWorkStore((s) => s.load)
  const upsert = useMyWorkStore((s) => s.upsert)
  const remove = useMyWorkStore((s) => s.remove)
  const collapseKey = `mine.collapsed.${org ?? ''}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(collapseKey) ?? '[]')) } catch { return new Set() }
  })

  useEffect(() => { if (items === null) void load() }, [items, load])
  useEffect(() => { if (selectedProject) void useWikiStore.getState().refreshFor(selectedProject) }, [selectedProject])
  useEffect(() => {
    // Keep rows in sync with edits made in the details panel.
    const onUpdated = (e: Event) => upsert((e as CustomEvent<WorkItem>).detail)
    window.addEventListener('app:item-updated', onUpdated)
    return () => window.removeEventListener('app:item-updated', onUpdated)
  }, [upsert])

  const sections = useMemo<Section[]>(() => {
    const byProject = (list: WorkItem[]) => {
      const map = new Map<string, WorkItem[]>()
      for (const it of list) {
        const p = String(it.fields['System.TeamProject'] ?? 'Other')
        if (!map.has(p)) map.set(p, [])
        map.get(p)!.push(it)
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    }
    // Resolved work reported by someone else waits on them, not me: it shows in their To verify instead.
    const all = (items ?? []).filter((it) => isShown(it, planning, showPlanning, types) && !isFinished(it, types) && !isWaitingOnReporter(it, types) && matchesSearch(it, search))
    // Active work: most urgent first, then most recently touched. To verify: oldest first so nothing waits forever.
    const active = all.filter((it) => !isToVerify(it, types)).sort((a, b) => priorityOf(a) - priorityOf(b) || changedOf(b).localeCompare(changedOf(a)))
    const verify = all.filter((it) => isToVerify(it, types)).sort((a, b) => changedOf(a).localeCompare(changedOf(b)))
    return [
      { key: 'active', title: 'Assigned to me', hint: 'Open work assigned to you', projects: byProject(active) },
      { key: 'verify', title: 'To verify', hint: 'Resolved items you reported, waiting for your check before they are closed (processes with a Resolved state, such as Agile and CMMI)', projects: byProject(verify) },
    ]
  }, [items, types, search, planning, showPlanning])

  // Active pull requests I wrote or review, by the work items they link to.
  const prsByItem = useMemo(() => {
    const m = new Map<number, PullRequest[]>()
    for (const p of involved) {
      for (const id of prItems[`${p.repository.id}:${p.pullRequestId}`] ?? []) m.set(id, [...(m.get(id) ?? []), p])
    }
    return m
  }, [involved, prItems])

  const openPr = (pr: PullRequest) => {
    setView('prs')
    void usePrStore.getState().open(pr)
  }

  const toggle = (k: string) => setCollapsed((c) => {
    const n = new Set(c)
    if (n.has(k)) n.delete(k); else n.add(k)
    try { localStorage.setItem(collapseKey, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })

  const openOnBoard = async (it: WorkItem) => {
    const name = String(it.fields['System.TeamProject'] ?? '')
    const p = projects.find((x) => x.name === name)
    if (!p) return
    await selectProject(p)
    setView('board')
    const unsub = useBoardStore.subscribe((s) => {
      if (s.items.some((x) => x.id === it.id)) { s.select(it.id); unsub() }
    })
    setTimeout(unsub, 15000)
  }

  /** Saves and reports; true when the server accepted the change. */
  const patch = async (it: WorkItem, fields: Record<string, unknown>, label: string): Promise<boolean> => {
    if (!org) return false
    try {
      const updated = await api().updateWorkItem(org, String(it.fields['System.TeamProject']), it.id, it.rev, fields)
      upsert(updated)
      useBoardStore.getState().upsert(updated)
      toast({ kind: 'success', title: label })
      return true
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', detail: errorMessage(e) })
      return false
    }
  }

  const contextMenu = (it: WorkItem) => {
    const project = String(it.fields['System.TeamProject'] ?? '')
    const type = typeOf(it, types)
    const states = (type?.states ?? []).filter((s) => s.category !== 'Removed' && s.name !== it.fields['System.State'])
    const verify = isToVerify(it, types)
    const linked = prsByItem.get(it.id) ?? []
    const assignedToMe = (it.fields['System.AssignedTo'] as { id?: string } | undefined)?.id === account?.userId
    const closeState = type?.states.find((s) => s.category === 'Completed')?.name ?? 'Closed'
    const reopenState = type?.states.find((s) => s.category === 'InProgress')?.name ?? 'Active'
    void api().showContextMenu([
      ...(verify ? [
        { label: `Verified · ${closeState}`, action: () => void patch(it, { 'System.State': closeState }, `#${it.id} → ${closeState}`).then((ok) => { if (ok) remove(it.id) }) },
        // Back to whoever owns it; it only stays here when that is me.
        { label: `Not fixed · ${reopenState}`, action: () => void patch(it, { 'System.State': reopenState }, `#${it.id} → ${reopenState}`).then((ok) => { if (ok && !assignedToMe) remove(it.id) }) },
        { separator: true },
      ] : []),
      { label: 'Show Details', action: () => void openItem(it) },
      // The sheet works on the item the details panel holds, so open it there first.
      { label: 'Start Work…', action: () => void openItem(it).then(() => useUiStore.getState().openSheet('start-work', { id: it.id })) },
      ...linked.map((p) => ({ label: `Open Pull Request !${p.pullRequestId}`, action: () => openPr(p) })),
      { label: 'Open on Board', action: () => void openOnBoard(it) },
      { label: 'Open in Browser', action: () => org && void api().openUrl(itemUrl(org, project, it.id)) },
      { label: 'Copy Link', action: () => { if (org) { void navigator.clipboard.writeText(itemUrl(org, project, it.id)); toast({ kind: 'success', title: 'Link copied' }) } } },
      { separator: true },
      ...(states.length ? [{ label: 'Set State', submenu: states.map((s) => ({ label: s.name, action: () => void patch(it, { 'System.State': s.name }, `#${it.id} → ${s.name}`) })) }] : []),
      { label: 'Set Priority', submenu: [1, 2, 3, 4].map((p) => ({ label: `P${p}`, action: () => void patch(it, { 'Microsoft.VSTS.Common.Priority': p }, `#${it.id} priority P${p}`) })) },
      { label: 'Unassign Me', action: () => void patch(it, { 'System.AssignedTo': null }, `#${it.id} unassigned`).then((ok) => { if (ok && !verify) remove(it.id) }) },
    ])
  }

  if (items === null && loading) return <div className="empty-state"><span className="spinner lg" /></div>
  if (error && !items) return <Empty title="Could not load your work" action={<button type="button" className="btn" onClick={() => void load()}>Try again</button>}>{error}</Empty>
  const shown = sections.reduce((a, sec) => a + sec.projects.reduce((b, [, l]) => b + l.length, 0), 0)
  // A search that only matches hidden planning items offers to show them rather than saying nothing matched.
  const hiddenMatches = showPlanning || !search.trim() ? 0 : planningCount((items ?? []).filter((it) => matchesSearch(it, search)), types, planning)
  if (shown === 0 && hiddenMatches > 0) return <Empty icon={<SearchX size={40} strokeWidth={1.2} />} title="Only planning items match" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setShowPlanning(true)}>Show planning items</button>}>{hiddenMatches} hidden requirement, feature or epic{hiddenMatches === 1 ? '' : 's'} match{hiddenMatches === 1 ? 'es' : ''} “{search.trim()}”.</Empty>
  if (items && items.length > 0 && shown === 0 && search.trim()) return <Empty icon={<SearchX size={40} strokeWidth={1.2} />} title="No matching work" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setSearch('')}>Clear search</button>}>Nothing in My Work matches “{search.trim()}”.</Empty>
  const hiddenPlanning = showPlanning ? 0 : planningCount(items, types, planning)
  if (shown === 0 && hiddenPlanning > 0) return <Empty icon={<Inbox size={40} strokeWidth={1.2} />} title="No tasks or bugs assigned to you" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setShowPlanning(true)}>Show planning items</button>}>{hiddenPlanning} planning item{hiddenPlanning === 1 ? ' is' : 's are'} hidden: requirements, features and epics assigned to you.</Empty>
  if (!items || items.length === 0) return <Empty icon={<Inbox size={40} strokeWidth={1.2} />} title={`Nothing assigned to ${account?.userName ?? 'you'}`}>When work items are assigned to you in any project, or resolved and waiting for your check, they will appear here.</Empty>

  return (
    <div className="list">
      {selectedProject && <WikiUpdatesStrip project={selectedProject.name} />}
      <table>
        <thead>
          <tr><th className="num">ID</th><th>Type</th><th>Title</th><th className="disc" title="Comments in the discussion"><MessageSquare size={13} /></th><th className="pri">Pri</th><th>State</th><th>Iteration</th><th>Changed</th></tr>
        </thead>
        <tbody>
          {sections.map((sec) => {
            const n = sec.projects.reduce((a, [, l]) => a + l.length, 0)
            if (n === 0 && (sec.key === 'verify' || search.trim())) return null
            const secCollapsed = collapsed.has(`§${sec.key}`)
            return (
              <SectionRows key={sec.key} section={sec} count={n} collapsed={secCollapsed} onToggle={() => toggle(`§${sec.key}`)}>
                {(!secCollapsed || search.trim()) && sec.projects.map(([project, list]) => (
                  <GroupRows key={project} project={project} list={list} types={types} collapsed={!search.trim() && collapsed.has(`${sec.key}/${project}`)} onToggle={() => toggle(`${sec.key}/${project}`)} onOpen={(it) => void openItem(it)} onMenu={contextMenu} selectedId={selectedId} unseen={(it) => isUnseen(it, highlightSince)} prs={(it) => prsByItem.get(it.id) ?? []} onOpenPr={openPr} />
                ))}
              </SectionRows>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SectionRows({ section, count, collapsed, onToggle, children }: { section: Section; count: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className={`section-row ${collapsed ? 'collapsed' : ''}`} onClick={onToggle}>
        <td colSpan={COLS}>
          <button type="button" title={section.hint}>
            <ChevronDown size={14} />
            {section.key === 'verify' && <CheckCircle2 size={14} className="sec-ico" />}
            {section.title} <span className="faint">· {count}</span>
          </button>
          {section.key === 'verify' && !collapsed && <span className="sec-hint">Right-click a row to close it as verified or send it back.</span>}
        </td>
      </tr>
      {count === 0 && !collapsed && <tr><td colSpan={COLS} className="faint" style={{ paddingLeft: 28 }}>Nothing open.</td></tr>}
      {children}
    </>
  )
}

function GroupRows({ project, list, types, collapsed, onToggle, onOpen, onMenu, selectedId, unseen, prs, onOpenPr }: {
  project: string; list: WorkItem[]; types: TypesByProject; collapsed: boolean; onToggle: () => void
  onOpen: (it: WorkItem) => void; onMenu: (it: WorkItem) => void; selectedId: number | null
  unseen: (it: WorkItem) => boolean; prs: (it: WorkItem) => PullRequest[]; onOpenPr: (pr: PullRequest) => void
}) {
  return (
    <>
      <tr className={`group-row ${collapsed ? 'collapsed' : ''}`} onClick={onToggle}>
        <td colSpan={COLS}><button type="button"><ChevronDown size={14} />{project} · {list.length}</button></td>
      </tr>
      {!collapsed && list.map((it) => {
        const f = it.fields
        const type = String(f['System.WorkItemType'] ?? '')
        const comments = f['System.CommentCount']
        const pri = f['Microsoft.VSTS.Common.Priority']
        return (
          <tr key={it.id} className={selectedId === it.id ? 'selected' : ''} onClick={() => onOpen(it)} onContextMenu={(e) => { e.preventDefault(); onMenu(it) }} style={{ ['--type-color' as string]: typeColor(types[project] ?? [], type) }} title="Click for details · right-click for more">
            <td className="num faint">{unseen(it) && <span className="unseen-dot" title="Changed by someone else since you last looked" />}{it.id}</td>
            <td><span className="typebar" />{type}</td>
            <td className="title">
              {String(f['System.Title'] ?? '')}
              {prs(it).map((p) => (
                <button key={p.pullRequestId} type="button" className={`pr-link ${p.isDraft ? 'draft' : ''}`} title={`${p.isDraft ? 'Draft pull request' : 'Open pull request'}: ${p.title}`} onClick={(e) => { e.stopPropagation(); onOpenPr(p) }}>
                  <GitPullRequest size={11} />!{p.pullRequestId}
                </button>
              ))}
            </td>
            <td className="disc">{typeof comments === 'number' && comments > 0 && <span className="meta" title={`${comments} comment${comments > 1 ? 's' : ''} in the discussion`}><MessageSquare size={13} />{comments}</span>}</td>
            <td className="pri">{typeof pri === 'number' && <span className={`pri p${pri}`}>P{pri}</span>}</td>
            <td>{String(f['System.State'] ?? '')}</td>
            <td className="muted">{String(f['System.IterationPath'] ?? '').split('\\').pop()}</td>
            <td className="muted">{relativeTime(f['System.ChangedDate'])}</td>
          </tr>
        )
      })}
    </>
  )
}
