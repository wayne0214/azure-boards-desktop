import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Account, BoardRef, Project, Settings, Team } from '@/lib/types'
import { boardTypes } from '@/lib/format'
import { errorMessage } from '@/lib/types'
import { useUiStore } from './useUiStore'

interface AppState {
  booted: boolean
  /** Why the saved settings could not be read at start, if they could not. */
  bootError: string | null
  settings: Settings
  activeOrg: string | null
  projects: Project[]
  projectsLoading: boolean
  projectsError: string | null
  selectedProject: Project | null
  teams: Team[]
  selectedTeam: Team | null
  boards: BoardRef[]
  /** Work item types shown by each real board, so the app can offer virtual boards for the rest. */
  boardTypesById: Record<string, string[]>
  selectedBoardId: string | null
  contextLoading: boolean

  boot(): Promise<void>
  applySettings(s: Settings): void
  switchOrg(org: string): Promise<void>
  loadProjects(opts?: { silent?: boolean }): Promise<void>
  selectProject(project: Project, opts?: { teamId?: string | null; boardId?: string | null }): Promise<void>
  selectTeam(team: Team, opts?: { boardId?: string | null }): Promise<void>
  selectBoard(boardId: string): void
  togglePin(project: Project): Promise<void>
  account(): Account | null
}

export const useAppStore = create<AppState>((set, get) => ({
  booted: false,
  bootError: null,
  settings: { accounts: [], activeOrg: null, recent: [], pinnedProjects: [] },
  activeOrg: null,
  projects: [],
  projectsLoading: false,
  projectsError: null,
  selectedProject: null,
  teams: [],
  selectedTeam: null,
  boards: [],
  boardTypesById: {},
  selectedBoardId: null,
  contextLoading: false,

  account: () => {
    const { settings, activeOrg } = get()
    return settings.accounts.find((a) => a.org === activeOrg) ?? null
  },

  applySettings: (settings) => set({ settings, activeOrg: settings.activeOrg }),

  boot: async () => {
    let settings: Settings
    try {
      settings = await api().getSettings()
    } catch (e) {
      set({ bootError: errorMessage(e) })
      return
    }
    set({ settings, activeOrg: settings.activeOrg, booted: true, bootError: null })
    if (settings.activeOrg) {
      await get().loadProjects()
      // Reopen the last project the user was in.
      const recent = settings.recent.find((r) => r.org === settings.activeOrg)
      const project = recent && get().projects.find((p) => p.id === recent.projectId)
      if (project && recent) {
        await get().selectProject(project, { teamId: recent.teamId, boardId: recent.boardId })
      }
    }
  },

  switchOrg: async (org) => {
    if (org === get().activeOrg) return
    const settings = await api().setActiveOrg(org)
    set({
      settings,
      activeOrg: org,
      projects: [],
      selectedProject: null,
      teams: [],
      selectedTeam: null,
      boards: [],
      selectedBoardId: null,
    })
    await get().loadProjects()
    const recent = settings.recent.find((r) => r.org === org)
    const project = recent && get().projects.find((p) => p.id === recent.projectId)
    if (project && recent) await get().selectProject(project, { teamId: recent.teamId, boardId: recent.boardId })
  },

  loadProjects: async (opts) => {
    const org = get().activeOrg
    if (!org) return
    // Show cached projects immediately, then refresh.
    const cached = await api().cacheGet<Project[]>(`${org}/projects`).catch(() => null)
    // The user may have switched organization while this was loading.
    if (get().activeOrg !== org) return
    if (cached?.value && get().projects.length === 0) set({ projects: cached.value })
    if (!opts?.silent) set({ projectsLoading: true, projectsError: null })
    try {
      const projects = await api().listProjects(org)
      if (get().activeOrg !== org) return
      set({ projects, projectsLoading: false })
    } catch (e) {
      if (get().activeOrg === org) set({ projectsLoading: false, projectsError: errorMessage(e) })
    }
  },

  selectProject: async (project, opts) => {
    const org = get().activeOrg
    if (!org) return
    set({ selectedProject: project, teams: [], selectedTeam: null, boards: [], selectedBoardId: null, contextLoading: true })
    { const v = useUiStore.getState().view; if (v === 'mine' || v === 'timesheet' || v === 'prs') useUiStore.getState().setView('board') }
    try {
      const [teams, defaultTeam] = await Promise.all([api().listTeams(org, project.id), api().defaultTeam(org, project.id).catch(() => null)])
      // Bail if the user already moved on.
      if (get().selectedProject?.id !== project.id) return
      set({ teams })
      const wanted = opts?.teamId ? teams.find((t) => t.id === opts.teamId) : null
      const team = wanted ?? (defaultTeam && teams.find((t) => t.id === defaultTeam.id)) ?? teams[0] ?? null
      if (team) await get().selectTeam(team, { boardId: opts?.boardId ?? null })
      else set({ contextLoading: false })
    } catch (e) {
      set({ contextLoading: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not open project', detail: errorMessage(e) })
    }
  },

  selectTeam: async (team, opts) => {
    const org = get().activeOrg
    const project = get().selectedProject
    if (!org || !project) return
    set({ selectedTeam: team, boards: [], selectedBoardId: null, contextLoading: true })
    try {
      const boards = await api().listBoards(org, project.name, team.name)
      if (get().selectedTeam?.id !== team.id) return
      const wanted = opts?.boardId && (opts.boardId.startsWith('virtual:') ? { id: opts.boardId, name: '' } : boards.find((b) => b.id === opts.boardId || b.name === opts.boardId))
      // Prefer the "requirements" level board (Stories / Backlog items / Issues) which is what people usually mean by "the board".
      const preferred = boards.find((b) => /stor|backlog item|issue|requirement|srs/i.test(b.name)) ?? boards[0]
      const chosen = wanted || preferred
      set({ boards, selectedBoardId: chosen?.id ?? null, contextLoading: false })
      // Learn which types the real boards cover (small, parallel, non-blocking).
      void Promise.all(boards.map((b) => api().getBoard(org, project.name, team.name, b.id).then((d) => [b.id, boardTypes(d)] as const).catch(() => [b.id, []] as const)))
        .then((pairs) => { if (get().selectedTeam?.id === team.id) set({ boardTypesById: Object.fromEntries(pairs) }) })
      void api().rememberTarget({
        org,
        projectId: project.id,
        projectName: project.name,
        teamId: team.id,
        teamName: team.name,
        boardId: chosen?.id ?? null,
      }).then((s) => set({ settings: s }))
    } catch (e) {
      set({ contextLoading: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not load boards', detail: errorMessage(e) })
    }
  },

  selectBoard: (boardId) => {
    set({ selectedBoardId: boardId })
    const { activeOrg, selectedProject, selectedTeam } = get()
    if (activeOrg && selectedProject && selectedTeam) {
      void api().rememberTarget({
        org: activeOrg,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        boardId,
      }).then((s) => set({ settings: s }))
    }
  },

  togglePin: async (project) => {
    const org = get().activeOrg
    if (!org) return
    const settings = await api().togglePinnedProject(`${org}/${project.id}`)
    set({ settings })
  },
}))
