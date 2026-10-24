import { ChevronDown, Download, ClipboardList, Clock3, Columns3, DoorOpen, FileInput, FlaskConical, GitPullRequest, FolderKanban, LayoutDashboard, ListTree, Users, Inbox, Pin, RefreshCw, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { pendingImports, useImportStore } from '@/components/imports/useImportStore'
import { api } from '@/lib/api'
import { installUpdate, useUpdateStore } from '@/lib/updater'
import { useAppStore } from '@/store/useAppStore'
import { attentionCount, useMyWorkStore } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import type { Project } from '@/lib/types'

export function Sidebar() {
  const settings = useAppStore((s) => s.settings)
  const update = useUpdateStore((s) => s.available)
  const activeOrg = useAppStore((s) => s.activeOrg)
  const projects = useAppStore((s) => s.projects)
  const projectsLoading = useAppStore((s) => s.projectsLoading)
  const projectsError = useAppStore((s) => s.projectsError)
  const selectedProject = useAppStore((s) => s.selectedProject)
  const teams = useAppStore((s) => s.teams)
  const selectedTeam = useAppStore((s) => s.selectedTeam)
  const selectProject = useAppStore((s) => s.selectProject)
  const selectTeam = useAppStore((s) => s.selectTeam)
  const togglePin = useAppStore((s) => s.togglePin)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const openSheet = useUiStore((s) => s.openSheet)
  const toast = useUiStore((s) => s.toast)
  const myCount = useMyWorkStore((s) => attentionCount(s.items, s.types, s.seenAt))
  const imports = useImportStore((s) => s.list)
  const importCount = pendingImports(imports)
  useEffect(() => { void useImportStore.getState().load() }, [])
  const prCount = usePrStore((s) => s.counts.review)
  const prError = usePrStore((s) => s.countsError)
  const prScope = usePrStore((s) => s.scope)

  const [q, setQ] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  // Large organizations get a filter that is always there instead of behind the search icon.
  const alwaysSearch = projects.length > 12
  const [restFolded, setRestFolded] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebar.restFolded') === '1' } catch { return false }
  })
  const toggleRest = () => setRestFolded((v) => {
    try { localStorage.setItem('sidebar.restFolded', v ? '0' : '1') } catch { /* ignore */ }
    return !v
  })

  const account = settings.accounts.find((a) => a.org === activeOrg)
  const pinned = new Set(settings.pinnedProjects)
  const isPinned = (p: Project) => pinned.has(`${activeOrg}/${p.id}`)

  const { pinnedList, rest } = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = t ? projects.filter((p) => p.name.toLowerCase().includes(t)) : projects
    return { pinnedList: list.filter(isPinned), rest: list.filter((p) => !isPinned(p)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, q, settings.pinnedProjects, activeOrg])

  const openProject = (p: Project, target: 'overview' | 'board' | 'list' | 'reqs' | 'tests' | 'plans' | 'team') => {
    if (view !== target) setView(target)
    if (selectedProject?.id !== p.id) void selectProject(p)
  }

  const projectMenu = (p: Project) => {
    const url = activeOrg ? `https://dev.azure.com/${encodeURIComponent(activeOrg)}/${encodeURIComponent(p.name)}` : null
    void api().showContextMenu([
      { label: 'Overview', action: () => openProject(p, 'overview') },
      { label: 'Requirements', action: () => openProject(p, 'reqs') },
      { label: 'Test Cases', action: () => openProject(p, 'tests') },
      { label: 'Test Plans', action: () => openProject(p, 'plans') },
      { label: 'Open Board', action: () => openProject(p, 'board') },
      { label: 'Team', action: () => openProject(p, 'team') },
      { label: 'Open List', action: () => openProject(p, 'list') },
      { label: 'Pull Requests', action: () => { usePrStore.getState().setScope(p.id); setView('prs') } },
      { separator: true },
      { label: isPinned(p) ? 'Unpin' : 'Pin to Top', action: () => void togglePin(p) },
      { separator: true },
      { label: 'Open in Browser', action: () => { if (url) void api().openUrl(url) } },
      { label: 'Copy Link', action: () => { if (url) { void navigator.clipboard.writeText(url); toast({ kind: 'success', title: 'Link copied' }) } } },
    ])
  }

  const renderProject = (p: Project) => {
    const active = selectedProject?.id === p.id
    const inProject = view === 'overview' || view === 'board' || view === 'list' || view === 'reqs' || view === 'tests' || view === 'plans' || view === 'team'
    const onBoard = view === 'board' || view === 'list'
    return (
      <div key={p.id}>
        <button
          type="button"
          className={`nav-item ${active && inProject ? 'parent' : ''}`}
          // A project opens on its overview; from the board it stays on the board.
          onClick={() => openProject(p, active && inProject ? (view as 'overview' | 'board' | 'list' | 'reqs' | 'tests' | 'plans' | 'team') : onBoard ? view : 'overview')}
          onContextMenu={(e) => { e.preventDefault(); projectMenu(p) }}
          title={p.description ?? p.name}
        >
          <span className="ico"><FolderKanban size={16} /></span>
          <span className="label">{p.name}</span>
          <span
            role="button"
            tabIndex={-1}
            className={`pin ${isPinned(p) ? 'on' : ''}`}
            title={isPinned(p) ? 'Unpin' : 'Pin to top'}
            onClick={(e) => { e.stopPropagation(); void togglePin(p) }}
          >
            <Pin size={13} />
          </span>
        </button>
        {active && (
          <div className="nav-sub">
            <button type="button" className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => openProject(p, 'overview')}>
              <span className="ico"><LayoutDashboard size={14} /></span>
              <span className="label">Overview</span>
            </button>
            <button type="button" className={`nav-item ${view === 'reqs' ? 'active' : ''}`} onClick={() => openProject(p, 'reqs')}>
              <span className="ico"><ListTree size={14} /></span>
              <span className="label">Requirements</span>
            </button>
            <button type="button" className={`nav-item ${view === 'tests' ? 'active' : ''}`} onClick={() => openProject(p, 'tests')}>
              <span className="ico"><FlaskConical size={14} /></span>
              <span className="label">Test Cases</span>
            </button>
            <button type="button" className={`nav-item ${view === 'plans' ? 'active' : ''}`} onClick={() => openProject(p, 'plans')}>
              <span className="ico"><ClipboardList size={14} /></span>
              <span className="label">Test Plans</span>
            </button>
            <button type="button" className={`nav-item ${onBoard ? 'active' : ''}`} onClick={() => openProject(p, view === 'list' ? 'list' : 'board')}>
              <span className="ico"><Columns3 size={14} /></span>
              <span className="label">Board</span>
            </button>
            {onBoard && teams.length > 1 && teams.map((t) => (
              <button key={t.id} type="button" className={`nav-item team ${selectedTeam?.id === t.id ? 'on' : ''}`} onClick={() => void selectTeam(t)}>
                <span className="label">{t.name}</span>
              </button>
            ))}
            <button type="button" className={`nav-item ${view === 'team' ? 'active' : ''}`} onClick={() => openProject(p, 'team')}>
              <span className="ico"><Users size={14} /></span>
              <span className="label">Team</span>
            </button>
            <button type="button" className={`nav-item ${view === 'prs' && prScope === p.id ? 'active' : ''}`} onClick={() => { usePrStore.getState().setScope(p.id); setView('prs') }}>
              <span className="ico"><GitPullRequest size={14} /></span>
              <span className="label">Pull Requests</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      {/* Kept as the window drag strip and traffic-light clearance. */}
      <div className="sidebar-top drag-region" data-tauri-drag-region />

      <div className="sidebar-scroll">
        <div className="nav-group">
          <button type="button" className={`nav-item ${view === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>
            <span className="ico"><Inbox size={16} /></span>
            <span className="label">My Work</span>
            {myCount > 0 && <span className="count attn" title="To verify, or changed by someone else since you last looked">{myCount}</span>}
          </button>
          <button type="button" className={`nav-item ${view === 'prs' ? 'active' : ''}`} onClick={() => setView('prs')}>
            <span className="ico"><GitPullRequest size={16} /></span>
            <span className="label">Pull Requests</span>
            {prCount > 0 && <span className="count attn" title={prError ? `Waiting on your vote. ${prError}` : 'Waiting on your vote'}>{prCount}</span>}
            {prCount === 0 && prError && <span className="count warn" title={prError}>!</span>}
          </button>
          <button type="button" className={`nav-item ${view === 'timesheet' ? 'active' : ''}`} onClick={() => setView('timesheet')}>
            <span className="ico"><Clock3 size={16} /></span>
            <span className="label">Timesheet</span>
          </button>
          <button type="button" className={`nav-item ${view === 'rooms' ? 'active' : ''}`} onClick={() => setView('rooms')}>
            <span className="ico"><DoorOpen size={16} /></span>
            <span className="label">Meeting Rooms</span>
          </button>
          {(imports.length > 0 || view === 'imports') && (
            <button type="button" className={`nav-item ${view === 'imports' ? 'active' : ''}`} onClick={() => setView('imports')}>
              <span className="ico"><FileInput size={16} /></span>
              <span className="label">Imports</span>
              {importCount > 0 && <span className="count attn" title="Staged by an AI tool, waiting for your review">{importCount}</span>}
            </button>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-head">
            <span>Projects</span>
            <span style={{ display: 'flex', gap: 2 }}>
              {!alwaysSearch && (
                <button type="button" title="Search projects" onClick={() => { setShowSearch((v) => !v); setQ('') }}>
                  <Search size={13} />
                </button>
              )}
              <button type="button" title="Refresh projects" onClick={() => void loadProjects()} disabled={projectsLoading}>
                <RefreshCw size={13} className={projectsLoading ? 'spin' : ''} />
              </button>
            </span>
          </div>
          {(showSearch || alwaysSearch) && (
            <div className="sidebar-search">
              <Search size={13} />
              <input autoFocus={!alwaysSearch} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects" onKeyDown={(e) => e.key === 'Escape' && (setShowSearch(false), setQ(''))} />
              {(q || !alwaysSearch) && <button type="button" className="icon-btn sm" onClick={() => { setShowSearch(false); setQ('') }}><X size={12} /></button>}
            </div>
          )}
          {pinnedList.map(renderProject)}
          {/* With pins, everything else folds away under one header; a filter always shows its matches. */}
          {pinnedList.length > 0 && rest.length > 0 && !q.trim() && (
            <button type="button" className={`nav-fold ${restFolded ? 'collapsed' : ''}`} onClick={toggleRest}>
              <ChevronDown size={12} /> All projects <span>· {rest.length}</span>
            </button>
          )}
          {(!restFolded || pinnedList.length === 0 || q.trim() ? rest : rest.filter((p) => p.id === selectedProject?.id)).map(renderProject)}
          {projects.length === 0 && projectsLoading && (
            <div style={{ padding: '6px 8px', display: 'grid', gap: 8 }}>
              <div className="skeleton" style={{ height: 22 }} />
              <div className="skeleton" style={{ height: 22, width: '70%' }} />
              <div className="skeleton" style={{ height: 22, width: '85%' }} />
            </div>
          )}
          {projects.length === 0 && !projectsLoading && (
            <div className="faint" style={{ padding: '6px 8px', fontSize: 'var(--fs-sm)' }}>
              {projectsError ?? 'No projects in this organization.'}
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        <button type="button" className="me" onClick={() => openSheet('settings')} title="Settings">
          <Avatar name={account?.userName} keyName={account?.userId} size="sm" />
          <span style={{ minWidth: 0 }}>
            <div className="label">{account?.userName ?? 'Account'}</div>
          </span>
        </button>
        {update && (
          <button type="button" className="icon-btn update-btn" onClick={() => void installUpdate(update)} title={`Boards ${update.version} is available. Update and restart`}>
            <Download size={16} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => openSheet('settings')} title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}
