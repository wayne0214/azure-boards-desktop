import { CheckCircle2, FlaskConical, Forward, GitPullRequest, Inbox, MessageSquare, SearchX, UserRound } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import { itemUrl, relativeTime, typeColor } from '@/lib/format'
import type { PullRequest } from '@/lib/pr/types'
import type { WorkItem } from '@/lib/types'
import { errorMessage } from '@/lib/types'
import { Empty } from '@/components/ui/Empty'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { CLOSED_DAYS, isUnseen, matchesSearch, myWorkProjects, myWorkTabs, planningCount, typeOf, useMyWorkStore, type MineTab, type TypesByProject } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { WikiUpdatesStrip } from '@/components/wiki/WikiUpdates'
import { useWikiStore } from '@/store/useWikiStore'

const TABS: { key: MineTab; title: string; hint: string; icon: React.ReactNode }[] = [
  { key: 'active', title: 'Assigned to me', hint: 'Open work assigned to you', icon: <UserRound size={14} /> },
  { key: 'test', title: 'Ready to test', hint: 'On the test server and assigned to you for testing', icon: <FlaskConical size={14} className="tab-ico test" /> },
  { key: 'others', title: 'Assigned to others', hint: 'Work you created or once held, now with someone else', icon: <Forward size={14} /> },
  { key: 'resolved', title: 'Resolved', hint: 'Resolved and still assigned to you, waiting for review. They leave My Work once someone else takes them or closes them.', icon: <CheckCircle2 size={14} className="tab-ico done" /> },
]

/**
 * Everything assigned to the signed-in user across the organization, one tab at a time: my open work, items to test,
 * work handed to someone else (open or recently closed) and resolved items. Projects are a column and a filter.
 */
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
  const others = useMyWorkStore((s) => s.others)
  const closed = useMyWorkStore((s) => s.closed)
  const closedLoading = useMyWorkStore((s) => s.closedLoading)
  const closedError = useMyWorkStore((s) => s.closedError)
  const tab = useMyWorkStore((s) => s.tab)
  const project = useMyWorkStore((s) => s.project)
  const othersMode = useMyWorkStore((s) => s.othersMode)
  const error = useMyWorkStore((s) => s.error)
  const loading = useMyWorkStore((s) => s.loading)
  const load = useMyWorkStore((s) => s.load)
  const upsert = useMyWorkStore((s) => s.upsert)
  const remove = useMyWorkStore((s) => s.remove)

  useEffect(() => { if (items === null) void load() }, [items, load])
  useEffect(() => { if (selectedProject) void useWikiStore.getState().refreshFor(selectedProject) }, [selectedProject])
  useEffect(() => {
    // Keep rows in sync with edits made in the details panel.
    const onUpdated = (e: Event) => upsert((e as CustomEvent<WorkItem>).detail)
    window.addEventListener('app:item-updated', onUpdated)
    return () => window.removeEventListener('app:item-updated', onUpdated)
  }, [upsert])

  const allProjects = useMemo(() => myWorkProjects(items, others, closed), [items, others, closed])
  // A remembered project with nothing left in My Work falls back to all projects.
  const shownProject = project && (items === null || allProjects.includes(project)) ? project : null
  const lists = useMemo(() => myWorkTabs({ items, others, closed, types, planning, showPlanning, search, project: shownProject }), [items, others, closed, types, planning, showPlanning, search, shownProject])

  // Tabs other than my own work appear when they hold something; while searching, all of them show their matches.
  // Assigned to others also stays for its Closed view, which loads only when asked for.
  const searching = !!search.trim()
  const visible = TABS.filter((t) => t.key === 'active' || searching || lists[t.key].length > 0 || t.key === tab || (t.key === 'others' && (closed?.length ?? 0) > 0))
  const current = visible.some((t) => t.key === tab) ? tab : 'active'
  const showClosed = current === 'others' && othersMode === 'closed'
  const rows = showClosed ? lists.closed : lists[current]
  const showProjectCol = !shownProject && allProjects.length > 1

  // Keys 1–4 pick a tab, as listed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      const t = visible[Number(e.key) - 1]
      if (t) { e.preventDefault(); useMyWorkStore.getState().setTab(t.key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

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
    const linked = prsByItem.get(it.id) ?? []
    // Work handed to someone else is theirs to start or unassign.
    const handedOff = current === 'others'
    void api().showContextMenu([
      { label: 'Show Details', action: () => void openItem(it) },
      // The sheet works on the item the details panel holds, so open it there first.
      ...(handedOff ? [] : [{ label: 'Start Work…', action: () => void openItem(it).then(() => useUiStore.getState().openSheet('start-work', { id: it.id })) }]),
      ...linked.map((p) => ({ label: `Open Pull Request !${p.pullRequestId}`, action: () => openPr(p) })),
      { label: 'Open on Board', action: () => void openOnBoard(it) },
      { label: 'Open in Browser', action: () => org && void api().openUrl(itemUrl(org, project, it.id)) },
      { label: 'Copy Link', action: () => { if (org) { void navigator.clipboard.writeText(itemUrl(org, project, it.id)); toast({ kind: 'success', title: 'Link copied' }) } } },
      { separator: true },
      ...(states.length ? [{ label: 'Set State', submenu: states.map((s) => ({ label: s.name, action: () => void patch(it, { 'System.State': s.name }, `#${it.id} → ${s.name}`) })) }] : []),
      { label: 'Set Priority', submenu: [1, 2, 3, 4].map((p) => ({ label: `P${p}`, action: () => void patch(it, { 'Microsoft.VSTS.Common.Priority': p }, `#${it.id} priority P${p}`) })) },
      ...(handedOff ? [] : [{ label: 'Unassign Me', action: () => void patch(it, { 'System.AssignedTo': null }, `#${it.id} unassigned`).then((ok) => { if (ok) remove(it.id) }) }]),
    ])
  }

  if (items === null && loading) return <div className="empty-state"><span className="spinner lg" /></div>
  if (error && !items) return <Empty title="Could not load your work" action={<button type="button" className="btn" onClick={() => void load()}>Try again</button>}>{error}</Empty>
  const shown = lists.active.length + lists.test.length + lists.others.length + lists.resolved.length + lists.closed.length
  // A search that only matches hidden planning items offers to show them rather than saying nothing matched.
  const hiddenMatches = showPlanning || !searching ? 0 : planningCount((items ?? []).filter((it) => matchesSearch(it, search)), types, planning)
  if (shown === 0 && hiddenMatches > 0) return <Empty icon={<SearchX size={40} strokeWidth={1.2} />} title="Only planning items match" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setShowPlanning(true)}>Show planning items</button>}>{hiddenMatches} hidden requirement, feature or epic{hiddenMatches === 1 ? '' : 's'} match{hiddenMatches === 1 ? 'es' : ''} “{search.trim()}”.</Empty>
  if (items && items.length > 0 && shown === 0 && searching) return <Empty icon={<SearchX size={40} strokeWidth={1.2} />} title="No matching work" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setSearch('')}>Clear search</button>}>Nothing in My Work{shownProject ? ` for ${shownProject}` : ''} matches “{search.trim()}”.</Empty>
  const hiddenPlanning = showPlanning ? 0 : planningCount(items, types, planning)
  if (shown === 0 && hiddenPlanning > 0 && !shownProject) return <Empty icon={<Inbox size={40} strokeWidth={1.2} />} title="No tasks or bugs assigned to you" action={<button type="button" className="btn" onClick={() => useMyWorkStore.getState().setShowPlanning(true)}>Show planning items</button>}>{hiddenPlanning} planning item{hiddenPlanning === 1 ? ' is' : 's are'} hidden: requirements, features and epics assigned to you.</Empty>
  if ((!items || items.length === 0) && shown === 0 && !shownProject) return <Empty icon={<Inbox size={40} strokeWidth={1.2} />} title={`Nothing assigned to ${account?.userName ?? 'you'}`}>When work items are assigned to you in any project, they will appear here.</Empty>

  const unseenIn = (k: MineTab) => lists[k].some((it) => isUnseen(it, highlightSince))
  const emptyText = showClosed ? `Nothing you handed off has closed in the last ${CLOSED_DAYS} days.` : current === 'others' ? 'Nothing you handed off is open.' : current === 'test' ? 'Nothing to test.' : current === 'resolved' ? 'Nothing resolved.' : 'Nothing open.'
  const cols = 8 + (showProjectCol ? 1 : 0)

  return (
    <>
      <div className="mine-bar">
        <div className="mine-tabs" role="tablist" aria-label="My Work">
          {visible.map((t, i) => (
            <button key={t.key} type="button" role="tab" aria-selected={current === t.key} className={`mine-tab ${current === t.key ? 'on' : ''}`} title={`${t.hint} · ${i + 1}`} onClick={() => useMyWorkStore.getState().setTab(t.key)}>
              {t.icon}{t.title}
              <span className={`count ${lists[t.key].length === 0 ? 'zero' : ''}`}>{lists[t.key].length}</span>
              {unseenIn(t.key) && <span className="unseen-dot" title="Changed by someone else since you last looked" />}
            </button>
          ))}
        </div>
        <span className="grow" />
        {current === 'others' && (
          <div className="segmented" role="group" aria-label="Open or closed">
            <button type="button" className={othersMode === 'open' ? 'on' : ''} onClick={() => useMyWorkStore.getState().setOthersMode('open')}>Open</button>
            <button type="button" className={othersMode === 'closed' ? 'on' : ''} onClick={() => useMyWorkStore.getState().setOthersMode('closed')} title={`Closed in the last ${CLOSED_DAYS} days`}>Closed{closed ? ` · ${lists.closed.length}` : ''}</button>
          </div>
        )}
        {(allProjects.length > 1 || shownProject) && (
          <select className="input tp-filter" aria-label="Project" value={shownProject ?? ''} onChange={(e) => useMyWorkStore.getState().setProject(e.target.value || null)}>
            <option value="">All projects</option>
            {allProjects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      <div className="list">
        {selectedProject && <WikiUpdatesStrip project={selectedProject.name} />}
        <table>
          <thead>
            <tr>
              <th className="num">ID</th><th>Type</th><th>Title</th><th className="disc" title="Comments in the discussion"><MessageSquare size={13} /></th>
              {showProjectCol && <th>Project</th>}<th className="pri">Pri</th><th>State</th><th>Iteration</th><th>{showClosed ? 'Closed' : 'Changed'}</th>
            </tr>
          </thead>
          <tbody>
            {showClosed && closedLoading && closed === null && <tr><td colSpan={cols} className="faint"><span className="spinner" /> Loading closed work…</td></tr>}
            {showClosed && closedError && closed === null && (
              <tr><td colSpan={cols} className="faint">Could not load closed work: {closedError} <button type="button" className="btn sm" onClick={() => void useMyWorkStore.getState().loadClosed()}>Try again</button></td></tr>
            )}
            {rows.length === 0 && !(showClosed && closed === null) && <tr><td colSpan={cols} className="faint">{emptyText}</td></tr>}
            {rows.map((it) => (
              <ItemRow key={it.id} it={it} types={types} who={current === 'others' ? (showClosed ? 'closedBy' : 'assignee') : null} showProject={showProjectCol} closedView={showClosed}
                selected={selectedId === it.id} unseen={isUnseen(it, highlightSince)} prs={prsByItem.get(it.id) ?? []} onOpen={() => void openItem(it)} onMenu={() => contextMenu(it)} onOpenPr={openPr} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

type Person = { displayName?: string } | undefined

function ItemRow({ it, types, who, showProject, closedView, selected, unseen, prs, onOpen, onMenu, onOpenPr }: {
  it: WorkItem; types: TypesByProject; who: 'assignee' | 'closedBy' | null; showProject: boolean; closedView: boolean
  selected: boolean; unseen: boolean; prs: PullRequest[]; onOpen: () => void; onMenu: () => void; onOpenPr: (pr: PullRequest) => void
}) {
  const f = it.fields
  const project = String(f['System.TeamProject'] ?? '')
  const type = String(f['System.WorkItemType'] ?? '')
  const comments = f['System.CommentCount']
  const pri = f['Microsoft.VSTS.Common.Priority']
  const closedBy = (f['Microsoft.VSTS.Common.ClosedBy'] as Person)?.displayName
  return (
    <tr className={selected ? 'selected' : ''} onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu() }} style={{ ['--type-color' as string]: typeColor(types[project] ?? [], type) }} title="Click for details · right-click for more">
      <td className="num faint">{unseen && <span className="unseen-dot" title="Changed by someone else since you last looked" />}{it.id}</td>
      <td><span className="typebar" />{type}</td>
      <td className="title">
        {String(f['System.Title'] ?? '')}
        {who === 'assignee' && <span className="assignee faint" title="Assigned to">→ {(f['System.AssignedTo'] as Person)?.displayName ?? 'Unassigned'}</span>}
        {who === 'closedBy' && closedBy && <span className="assignee faint">closed by {closedBy}</span>}
        {prs.map((p) => (
          <button key={p.pullRequestId} type="button" className={`pr-link ${p.isDraft ? 'draft' : ''}`} title={`${p.isDraft ? 'Draft pull request' : 'Open pull request'}: ${p.title}`} onClick={(e) => { e.stopPropagation(); onOpenPr(p) }}>
            <GitPullRequest size={11} />!{p.pullRequestId}
          </button>
        ))}
      </td>
      <td className="disc">{typeof comments === 'number' && comments > 0 && <span className="meta" title={`${comments} comment${comments > 1 ? 's' : ''} in the discussion`}><MessageSquare size={13} />{comments}</span>}</td>
      {showProject && <td className="muted project">{project}</td>}
      <td className="pri">{typeof pri === 'number' && <span className={`pri p${pri}`}>P{pri}</span>}</td>
      <td>{String(f['System.State'] ?? '')}</td>
      <td className="muted">{String(f['System.IterationPath'] ?? '').split('\\').pop()}</td>
      <td className="muted">{relativeTime(String((closedView && f['Microsoft.VSTS.Common.ClosedDate']) || f['System.ChangedDate'] || ''))}</td>
    </tr>
  )
}
