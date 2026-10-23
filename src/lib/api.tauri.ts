import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { Api, ContextMenuItem, ToolLine } from './api'
import { csvUnguard } from './format'

async function buildItems(items: ContextMenuItem[]): Promise<(MenuItem | PredefinedMenuItem | Submenu)[]> {
  const out: (MenuItem | PredefinedMenuItem | Submenu)[] = []
  for (const it of items) {
    if (it.separator) {
      out.push(await PredefinedMenuItem.new({ item: 'Separator' }))
    } else if (it.submenu) {
      out.push(
        await Submenu.new({
          text: it.label ?? '',
          enabled: it.enabled ?? true,
          items: await buildItems(it.submenu),
        }),
      )
    } else {
      out.push(
        await MenuItem.new({
          id: it.id,
          text: it.label ?? '',
          enabled: it.enabled ?? true,
          action: it.action,
        }),
      )
    }
  }
  return out
}

export const tauriApi: Api = {
  getSettings: () => invoke('get_settings'),
  testConnection: (org, pat) => invoke('test_connection', { org, pat }),
  addAccount: (org, pat) => invoke('add_account', { org, pat }),
  removeAccount: (org) => invoke('remove_account', { org }),
  setActiveOrg: (org) => invoke('set_active_org', { org }),
  rememberTarget: (target) => invoke('remember_target', { target }),
  togglePinnedProject: (key) => invoke('toggle_pinned_project', { key }),

  listProjects: (org) => invoke('list_projects', { org }),
  listTeams: (org, projectId) => invoke('list_teams', { org, projectId }),
  defaultTeam: (org, projectId) => invoke('default_team', { org, projectId }),
  listBoards: (org, project, team) => invoke('list_boards', { org, project, team }),
  getBoard: (org, project, team, boardId) => invoke('get_board', { org, project, team, boardId }),
  getTeamContext: (org, projectId, project, team) => invoke('get_team_context', { org, projectId, project, team }),
  queryBoardItems: (org, query) => invoke('query_board_items', { org, query }),
  myWork: (org) => invoke('my_work', { org }),
  mentionedItems: (org) => invoke('mentioned_items', { org }),
  projectItems: (org, project, types, excludeStates, extraFields, withRelations) => invoke('project_items', { org, project, types, excludeStates, extraFields, withRelations: withRelations ?? false }),
  addLink: (org, project, id, targetId, rel) => invoke('add_link', { org, project, id, targetId, rel }),
  removeLink: (org, project, id, targetId, rel) => invoke('remove_link', { org, project, id, targetId, rel }),
  tpMirrorResult: (org, project, input) => invoke('tp_mirror_result', { org, project, input }),
  tpPlans: (org, project, activeOnly) => invoke('tp_plans', { org, project, activeOnly }),
  tpCreatePlan: (org, project, input) => invoke('tp_create_plan', { org, project, input }),
  tpSuites: (org, project, planId) => invoke('tp_suites', { org, project, planId }),
  tpCreateSuite: (org, project, planId, input) => invoke('tp_create_suite', { org, project, planId, input }),
  tpAddCases: (org, project, planId, suiteId, ids, configurationIds) => invoke('tp_add_cases', { org, project, planId, suiteId, ids, configurationIds }),
  tpRemoveCases: (org, project, planId, suiteId, ids) => invoke('tp_remove_cases', { org, project, planId, suiteId, ids }),
  tpConfigurations: (org, project) => invoke('tp_configurations', { org, project }),
  tpPoints: (org, project, planId, suiteId) => invoke('tp_points', { org, project, planId, suiteId }),
  tpUpdatePoints: (org, project, planId, suiteId, updates) => invoke('tp_update_points', { org, project, planId, suiteId, updates }),
  tpPublishRun: (org, project, input) => invoke('tp_publish_run', { org, project, input }),
  tpSetPlanState: (org, project, planId, state) => invoke('tp_set_plan_state', { org, project, planId, planState: state }),
  tpRuns: (org, project, planId) => invoke('tp_runs', { org, project, planId }),
  tpRunResults: (org, project, runIds) => invoke('tp_run_results', { org, project, runIds }),
  getUpdates: (org, project, id) => invoke('get_updates', { org, project, id }),
  workItemTypes: (org, project) => invoke('work_item_types', { org, project }),
  searchWorkItems: (org, project, text) => invoke('search_work_items', { org, project, text }),
  getWorkItem: (org, project, id) => invoke('get_work_item', { org, project, id }),
  getChildren: (org, project, id) => invoke('get_children', { org, project, id }),
  getComments: (org, project, id) => invoke('get_comments', { org, project, id }),
  getAreaTree: (org, project) => invoke('get_classification_nodes', { org, project, group: 'areas' }),
  createArea: (org, project, parent, name) => invoke('create_area', { org, project, parent, name }),
  teamAreas: (org, project, team) => invoke('team_areas', { org, project, team }),

  createWorkItem: (org, project, workItemType, fields, parentId) =>
    invoke('create_work_item', { org, project, workItemType, fields, parentId }),
  updateWorkItem: (org, project, id, rev, fields) => invoke('update_work_item', { org, project, id, rev, fields }),
  setParent: (org, project, id, parentId) => invoke('set_parent', { org, project, id, parentId }),
  deleteWorkItem: (org, project, id) => invoke('delete_work_item', { org, project, id }),
  addComment: (org, project, id, text) => invoke('add_comment', { org, project, id, text }),

  fetchAttachment: (org, url) => invoke('fetch_attachment', { org, url }),
  uploadAttachment: (org, project, fileName, dataBase64) => invoke('upload_attachment', { org, project, fileName, dataBase64 }),
  cacheGet: (key) => invoke('cache_get', { key }),
  cacheSet: (key, value) => invoke('cache_set', { key, value }),
  cacheClear: () => invoke('cache_clear'),

  readCsv: async (path) => {
    const data = await invoke<{ headers: string[]; rows: string[][] }>('read_csv', { path })
    return { headers: data.headers, rows: data.rows.map((r) => r.map(csvUnguard)) }
  },
  writeTextFile: (path, content) => invoke('write_text_file', { path, content }),
  importWorkItems: (org, project, rows) => invoke('import_work_items', { org, project, rows }),

  prListRepos: (org, project) => invoke('pr_list_repos', { org, project }),
  prList: (org, project, status, opts) => invoke('pr_list', { org, project, status, creatorId: opts?.creatorId ?? null, reviewerId: opts?.reviewerId ?? null, repoId: opts?.repoId ?? null, top: opts?.top ?? null }),
  prDetail: (org, projectId, repoId, prId) => invoke('pr_detail', { org, projectId, repoId, prId }),
  prWorkItemIds: (org, repoId, prId) => invoke('pr_work_item_ids', { org, repoId, prId }),
  prBranchWorkItems: (org, projectId, repoId, source, target) => invoke('pr_branch_work_items', { org, projectId, repoId, source, target }),
  prLinkWorkItem: (org, projectId, repoId, prId, workItemId, linked) => invoke('pr_link_work_item', { org, projectId, repoId, prId, workItemId, linked }),
  prChanges: (org, repoId, prId, iteration, compareTo) => invoke('pr_changes', { org, repoId, prId, iteration, compareTo: compareTo ?? null }),
  prThreads: (org, repoId, prId) => invoke('pr_threads', { org, repoId, prId }),
  prCreateThread: (org, repoId, prId, body) => invoke('pr_create_thread', { org, repoId, prId, body }),
  prReply: (org, repoId, prId, threadId, parentId, content) => invoke('pr_reply', { org, repoId, prId, threadId, parentId, content }),
  prUpdateThread: (org, repoId, prId, threadId, body) => invoke('pr_update_thread', { org, repoId, prId, threadId, body }),
  prUpdateComment: (org, repoId, prId, threadId, commentId, content) => invoke('pr_update_comment', { org, repoId, prId, threadId, commentId, content }),
  prDeleteComment: (org, repoId, prId, threadId, commentId) => invoke('pr_delete_comment', { org, repoId, prId, threadId, commentId }),
  prVote: (org, repoId, prId, reviewerId, vote) => invoke('pr_vote', { org, repoId, prId, reviewerId, vote }),
  prAddReviewer: (org, repoId, prId, reviewerId, required) => invoke('pr_add_reviewer', { org, repoId, prId, reviewerId, required }),
  prRemoveReviewer: (org, repoId, prId, reviewerId) => invoke('pr_remove_reviewer', { org, repoId, prId, reviewerId }),
  prUpdate: (org, repoId, prId, body) => invoke('pr_update', { org, repoId, prId, body }),
  prCreate: (org, repoId, body) => invoke('pr_create', { org, repoId, body }),
  prBranches: (org, repoId) => invoke('pr_branches', { org, repoId }),
  prGet: (org, repoId, prId) => invoke('pr_get', { org, repoId, prId }),
  prChecks: (org, projectId, repoId, prId) => invoke('pr_checks', { org, projectId, repoId, prId }),
  prStartBranch: (org, projectId, repoId, name, base, workItemId) => invoke('pr_start_branch', { org, projectId, repoId, name, base, workItemId }),
  prFile: (org, repoId, path, commit) => invoke('pr_file', { org, repoId, path, commit }),
  prProjectMembers: (org, projectId) => invoke('pr_project_members', { org, projectId }),

  roomsHasKey: () => invoke('rooms_has_key'),
  roomsList: (calendar) => invoke('rooms_list', { calendar }),
  roomsFields: (calendar) => invoke('rooms_fields', { calendar }),
  roomsEvents: (calendar, startDate, endDate) => invoke('rooms_events', { calendar, startDate, endDate }),
  roomsBook: (calendar, event) => invoke('rooms_book', { calendar, event }),
  roomsCancel: (calendar, eventId, version) => invoke('rooms_cancel', { calendar, eventId, version: version ?? null }),

  gitCurrentBranch: (repoPath) => invoke('git_current_branch', { repoPath }),
  gitCheckoutBranch: (repoPath, branch) => invoke('git_checkout_branch', { repoPath, branch }),
  runGitTools: (repoPath, bin, args, onOutput) => {
    const ch = new Channel<ToolLine>()
    if (onOutput) ch.onmessage = onOutput
    return invoke('run_git_tools', { repoPath, bin, args, onOutput: ch })
  },
  cancelGitTools: () => invoke('cancel_git_tools'),
  pickFolder: async () => {
    const res = await openDialog({ directory: true, multiple: false })
    return typeof res === 'string' ? res : null
  },

  // The file dialogs run in Rust, which only lets read_csv and write_text_file use the paths they returned.
  pickCsvFile: () => invoke('pick_csv_file'),
  pickOpenFile: (filter) => invoke('pick_open_file', { filterName: filter.name, extensions: filter.extensions }),
  readTextFile: (path) => invoke('read_text_file', { path }),
  pickSavePath: (defaultName, filter) => invoke('pick_save_path', { defaultName, filterName: filter?.name ?? null, extensions: filter?.extensions ?? null }),
  openUrl: (url) => openUrl(url),
  onMenu: (handler) => {
    let active = true
    const p = listen<string>('menu', (e) => active && handler(e.payload))
    return () => {
      active = false
      p.then((un) => un())
    }
  },
  onImportProgress: (handler) => {
    let active = true
    const p = listen('import-progress', (e) => active && handler(e.payload as never))
    return () => {
      active = false
      p.then((un) => un())
    }
  },
  showContextMenu: async (items) => {
    const menu = await Menu.new({ items: await buildItems(items) })
    await menu.popup()
  },
}
