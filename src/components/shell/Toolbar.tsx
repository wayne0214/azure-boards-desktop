import { CalendarDays, ChevronDown, ClipboardList, Clock3, DoorOpen, FlaskConical, ListTree, Users, GitPullRequest, Columns3, ExternalLink, Filter, LayoutList, PanelLeft, PanelRight, Plus, RefreshCw, Search, User, X, FileInput } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { boardUrl } from '@/lib/format'
import { Dropdown, type Option } from '@/components/ui/Dropdown'
import { useAppStore } from '@/store/useAppStore'
import { refreshCurrentView } from '@/lib/refresh'
import { useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { useUiStore } from '@/store/useUiStore'

export function Toolbar() {
  const activeOrg = useAppStore((s) => s.activeOrg)
  const project = useAppStore((s) => s.selectedProject)
  const teams = useAppStore((s) => s.teams)
  const team = useAppStore((s) => s.selectedTeam)
  const boards = useAppStore((s) => s.boards)
  const boardTypesById = useAppStore((s) => s.boardTypesById)
  const boardId = useAppStore((s) => s.selectedBoardId)
  const selectTeam = useAppStore((s) => s.selectTeam)
  const selectBoard = useAppStore((s) => s.selectBoard)

  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const inspectorOpen = useUiStore((s) => s.inspectorOpen)
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const openSheet = useUiStore((s) => s.openSheet)

  const filters = useBoardStore((s) => s.filters)
  const setFilters = useBoardStore((s) => s.setFilters)
  const boardRefreshing = useBoardStore((s) => s.refreshing)
  const mineLoading = useMyWorkStore((s) => s.loading)
  const mineSearch = useMyWorkStore((s) => s.search)
  const setMineSearch = useMyWorkStore((s) => s.setSearch)
  const ctx = useBoardStore((s) => s.ctx)
  const board = useBoardStore((s) => s.board)

  const [menu, setMenu] = useState<null | 'team' | 'board' | 'iteration' | 'filter'>(null)
  const teamBtn = useRef<HTMLButtonElement>(null)
  const boardBtn = useRef<HTMLButtonElement>(null)
  const iterBtn = useRef<HTMLButtonElement>(null)
  const filterBtn = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState(filters.search)

  useEffect(() => setSearch(filters.search), [filters.search])
  useEffect(() => {
    const t = setTimeout(() => search !== filters.search && setFilters({ search }), 120)
    return () => clearTimeout(t)
  }, [search, filters.search, setFilters])

  useEffect(() => {
    const onFocus = () => searchRef.current?.focus()
    window.addEventListener('app:focus-search', onFocus)
    return () => window.removeEventListener('app:focus-search', onFocus)
  }, [])

  const boardOptions: Option[] = useMemo(() => {
    const real: Option[] = boards.map((b) => ({ value: b.id, label: b.name, group: 'Boards' }))
    const covered = new Set(Object.values(boardTypesById).flat())
    const hidden = /test (case|plan|suite)|shared (steps|parameter)|code review|feedback/i
    const extra: Option[] = (ctx?.workItemTypes ?? [])
      .filter((t) => !t.isDisabled && !covered.has(t.name) && !hidden.test(t.name))
      .map((t) => ({ value: `virtual:${t.name}`, label: `${t.name}s`.replace(/ys$/, 'ies'), sub: 'by state', group: 'Other work' }))
    return [...real, ...extra]
  }, [boards, boardTypesById, ctx])
  const currentBoardLabel = boardOptions.find((b) => b.value === boardId)?.label ?? (boardId?.startsWith('virtual:') ? `${boardId.slice(8)}s` : 'Board')

  const iterOptions: Option[] = useMemo(() => {
    const list = ctx?.iterations ?? []
    const current = list.filter((i) => i.attributes?.timeFrame === 'current')
    const future = list.filter((i) => i.attributes?.timeFrame === 'future')
    const past = list.filter((i) => i.attributes?.timeFrame === 'past').slice(-4).reverse()
    const opt = (i: (typeof list)[number], group: string) => ({ value: i.path, label: i.name, group })
    return [
      { value: '', label: 'All iterations' },
      ...current.map((i) => opt(i, 'Current')),
      ...future.map((i) => opt(i, 'Upcoming')),
      ...past.map((i) => opt(i, 'Recent')),
    ]
  }, [ctx])

  const currentIterLabel = filters.iterationPath
    ? ctx?.iterations.find((i) => i.path === filters.iterationPath)?.name ?? filters.iterationPath.split('\\').pop()
    : 'All iterations'

  const activeFilterCount = (filters.mine ? 1 : 0) + filters.types.length + filters.tags.length + filters.assignees.length

  const typeOptions: Option[] = (board ? Object.keys(board.columns.reduce((acc, c) => ({ ...acc, ...c.stateMappings }), {} as Record<string, string>)) : []).map((t) => ({ value: `type:${t}`, label: t, group: 'Type' }))
  const assigneeOptions: Option[] = (ctx?.members ?? []).map((m) => ({ value: `who:${m.uniqueName ?? m.id}`, label: m.displayName, group: 'Assigned to' }))
  const tagOptions: Option[] = (ctx?.tags ?? []).map((t) => ({ value: `tag:${t}`, label: t, group: 'Tag' }))
  const filterOptions: Option[] = [{ value: 'mine', label: 'Assigned to me', group: 'Quick' }, ...typeOptions, ...assigneeOptions, ...tagOptions]
  const filterValue = [
    ...(filters.mine ? ['mine'] : []),
    ...filters.types.map((t) => `type:${t}`),
    ...filters.assignees.map((a) => `who:${a}`),
    ...filters.tags.map((t) => `tag:${t}`),
  ]
  const toggleFilter = (v: string) => {
    if (v === 'mine') return setFilters({ mine: !filters.mine })
    const [kind, ...rest] = v.split(':')
    const val = rest.join(':')
    const toggle = (arr: string[]) => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
    if (kind === 'type') setFilters({ types: toggle(filters.types) })
    if (kind === 'who') setFilters({ assignees: toggle(filters.assignees) })
    if (kind === 'tag') setFilters({ tags: toggle(filters.tags) })
  }

  const isMine = view === 'mine'
  const isTimesheet = view === 'timesheet'
  const isPrs = view === 'prs'
  // Imports has no board controls, like Meeting Rooms.
  const isRooms = view === 'rooms' || view === 'imports'
  const isImports = view === 'imports'
  // Test Cases and Test Plans sit beside Requirements and share its toolbar.
  const isReqs = view === 'reqs' || view === 'tests' || view === 'plans'
  const isTests = view === 'tests'
  const isPlans = view === 'plans'
  const section = isPlans ? 'Test Plans' : isTests ? 'Test Cases' : 'Requirements'
  const isTeam = view === 'team'
  const refreshing = isMine ? mineLoading : boardRefreshing

  return (
    <div className="toolbar drag-region" data-tauri-drag-region>
      {!sidebarOpen && (
        <button type="button" className="icon-btn no-drag" onClick={toggleSidebar} title="Show sidebar">
          <PanelLeft size={17} />
        </button>
      )}
      {sidebarOpen && (
        <button type="button" className="icon-btn no-drag" onClick={toggleSidebar} title="Hide sidebar">
          <PanelLeft size={17} />
        </button>
      )}

      {isTeam ? (
        <div className="crumbs no-drag">
          <span className="crumb"><Users size={16} /><span className="txt">{project?.name ?? 'Team'}</span></span>
          {project && <><span className="crumb-sep">/</span><span className="crumb sub"><span className="txt">Team</span></span></>}
        </div>
      ) : isReqs ? (
        <div className="crumbs no-drag">
          <span className="crumb">{isPlans ? <ClipboardList size={16} /> : isTests ? <FlaskConical size={16} /> : <ListTree size={16} />}<span className="txt">{project ? `${project.name}` : section}</span></span>
          {project && <><span className="crumb-sep">/</span><span className="crumb sub"><span className="txt">{section}</span></span></>}
        </div>
      ) : isRooms ? (
        <div className="crumbs no-drag">
          <span className="crumb">{isImports ? <FileInput size={16} /> : <DoorOpen size={16} />}<span className="txt">{isImports ? 'Imports' : 'Meeting Rooms'}</span></span>
        </div>
      ) : isPrs ? (
        <div className="crumbs no-drag">
          <span className="crumb"><GitPullRequest size={16} /><span className="txt">Pull Requests</span></span>
        </div>
      ) : isTimesheet ? (
        <div className="crumbs no-drag">
          <span className="crumb"><Clock3 size={16} /><span className="txt">Timesheet</span></span>
        </div>
      ) : isMine ? (
        <div className="crumbs no-drag">
          <span className="crumb"><User size={16} /><span className="txt">My Work</span></span>
        </div>
      ) : project ? (
        <div className="crumbs no-drag">
          {teams.length > 1 && (
            <>
              <button ref={teamBtn} type="button" className="crumb" onClick={() => setMenu('team')} title="Switch team">
                <span className="txt">{team?.name}</span>
                <ChevronDown size={14} className="chev" />
              </button>
              <span className="crumb-sep">/</span>
            </>
          )}
          <button ref={boardBtn} type="button" className={`crumb ${teams.length > 1 ? 'sub' : ''}`} onClick={() => setMenu('board')} title="Switch board">
            <span className="txt">{currentBoardLabel}</span>
            <ChevronDown size={14} className="chev" />
          </button>
          <Dropdown anchor={teamBtn.current} open={menu === 'team'} onClose={() => setMenu(null)} options={teams.map((t) => ({ value: t.id, label: t.name }))} value={team?.id} searchable={teams.length > 8} width={260} onSelect={(id) => { const t = teams.find((x) => x.id === id); if (t) void selectTeam(t) }} />
          <Dropdown anchor={boardBtn.current} open={menu === 'board'} onClose={() => setMenu(null)} options={boardOptions} value={boardId} width={240} onSelect={selectBoard} />
        </div>
      ) : (
        <div className="crumbs no-drag"><span className="crumb sub"><span className="txt">Choose a project</span></span></div>
      )}

      <div className="grow" data-tauri-drag-region />

      {isMine && (
        <div className="search-box no-drag">
          <Search size={14} />
          <input ref={searchRef} value={mineSearch} onChange={(e) => setMineSearch(e.target.value)} placeholder="Search title, #id, tag, project" onKeyDown={(e) => { if (e.key === 'Escape') { setMineSearch(''); (e.target as HTMLInputElement).blur() } }} />
          {mineSearch && <button type="button" className="clear" onClick={() => setMineSearch('')}><X size={13} /></button>}
        </div>
      )}

      {!isMine && !isTimesheet && !isPrs && !isRooms && !isReqs && !isTeam && project && (
        <>
          <div className="search-box no-drag">
            <Search size={14} />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by title, #id, tag" onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur() } }} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')}><X size={13} /></button>}
          </div>
          <button ref={iterBtn} type="button" className={`btn no-drag ${filters.iterationPath ? 'on' : ''}`} onClick={() => setMenu('iteration')} title="Iteration">
            <CalendarDays size={15} /> {currentIterLabel}
          </button>
          <Dropdown anchor={iterBtn.current} open={menu === 'iteration'} onClose={() => setMenu(null)} options={iterOptions} value={filters.iterationPath ?? ''} width={260} onSelect={(v) => setFilters({ iterationPath: v || null })} />
          <button ref={filterBtn} type="button" className={`btn no-drag ${activeFilterCount ? 'on' : ''}`} onClick={() => setMenu('filter')} title="Filters">
            <Filter size={15} /> {activeFilterCount ? `${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}` : 'Filter'}
          </button>
          <Dropdown anchor={filterBtn.current} open={menu === 'filter'} onClose={() => setMenu(null)} options={filterOptions} value={filterValue} multi searchable width={280} onSelect={toggleFilter} align="right" />
          <div className="divider" />
          <div className="segmented no-drag">
            <button type="button" className={view === 'board' ? 'on' : ''} onClick={() => setView('board')} title="Board (⌘1)"><Columns3 size={15} /> Board</button>
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="List (⌘2)"><LayoutList size={15} /> List</button>
          </div>
          <div className="divider" />
        </>
      )}

      {!isTimesheet && !isPrs && !isRooms && !isReqs && !isTeam && <button type="button" className="icon-btn no-drag" onClick={refreshCurrentView} title="Refresh (⌘R)" disabled={refreshing}>
        <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
      </button>}
      {!isMine && !isTimesheet && !isPrs && !isRooms && !isReqs && !isTeam && project && team && boardId && !boardId.startsWith('virtual:') && (
        <button type="button" className="icon-btn no-drag" title="Open in Azure DevOps" onClick={() => activeOrg && void api().openUrl(boardUrl(activeOrg, project.name, team.name, boards.find((b) => b.id === boardId)?.name ?? ''))}>
          <ExternalLink size={16} />
        </button>
      )}
      {!isTimesheet && !isPrs && !isRooms && <button type="button" className={`icon-btn no-drag ${inspectorOpen ? 'on' : ''}`} onClick={() => toggleInspector()} title="Details (⌘I)">
        <PanelRight size={17} />
      </button>}
      {!isTimesheet && !isPrs && !isRooms && !isReqs && !isTeam && (project || isMine) && (
        <button type="button" className="btn primary no-drag" onClick={() => openSheet('new-item')} title="New work item (⌘N)">
          <Plus size={15} /> New
        </button>
      )}
    </div>
  )
}
