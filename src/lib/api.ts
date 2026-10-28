import type {
  Board,
  BoardQuery,
  BoardRef,
  CacheEntry,
  Comment,
  ConnectionInfo,
  CsvData,
  Identity,
  ImportResult,
  ImportRow,
  Project,
  RecentTarget,
  Settings,
  Team,
  TeamContext,
  WorkItem,
  WorkItemType,
} from './types'
import type { BranchWorkItem, PrDetail, PullRequest, Repo, Thread } from './pr/types'
import type { Booking, NewBooking, Room } from './rooms/types'
import type { VersioningFacts, VersioningFix } from './versioning/evaluate'
import type { FoundItems, ItemFilter, Wiki, WikiChange, WikiPage, WikiPageNode, WikiSearchResult } from './wiki/types'
import type { Markable, NewPlanInput, ResultQuery, RunInput, TestResultDetail, TestResultSummary, TpConfiguration, TpPlan, TpPoint, TpResult, TpRun, TpSuite } from './testplans/types'
import { useUiStore } from '@/store/useUiStore'

export interface Api {
  getSettings(): Promise<Settings>
  testConnection(org: string, pat: string): Promise<ConnectionInfo>
  addAccount(org: string, pat: string): Promise<Settings>
  removeAccount(org: string): Promise<Settings>
  setActiveOrg(org: string): Promise<Settings>
  rememberTarget(target: RecentTarget): Promise<Settings>
  togglePinnedProject(key: string): Promise<Settings>

  listProjects(org: string): Promise<Project[]>
  listTeams(org: string, projectId: string): Promise<Team[]>
  defaultTeam(org: string, projectId: string): Promise<Team | null>
  listBoards(org: string, project: string, team: string): Promise<BoardRef[]>
  getBoard(org: string, project: string, team: string, boardId: string): Promise<Board>
  getTeamContext(org: string, projectId: string, project: string, team: string): Promise<TeamContext>
  queryBoardItems(org: string, query: BoardQuery): Promise<WorkItem[]>
  myWork(org: string): Promise<WorkItem[]>
  /** Types at the project's requirement and portfolio backlog levels (User Story, Requirement, Feature, Epic…). */
  planningTypes(org: string, project: string): Promise<string[]>
  /** Work items that mentioned the user in the last week. */
  mentionedItems(org: string): Promise<WorkItem[]>
  /** Every item of these types in a project, across all teams (for the requirements tree). */
  projectItems(org: string, project: string, types: string[], excludeStates: string[], extraFields: string[], withRelations?: boolean): Promise<WorkItem[]>
  /** Link `id` to `targetId`, e.g. a change request that Affects a requirement. */
  addLink(org: string, project: string, id: number, targetId: number, rel: 'Microsoft.VSTS.Common.Affects-Forward' | 'System.LinkTypes.Related' | 'Microsoft.VSTS.Common.TestedBy-Reverse'): Promise<WorkItem>
  /** Remove one link from `id` to `targetId`; does nothing when it is not there. */
  removeLink(org: string, project: string, id: number, targetId: number, rel: string): Promise<WorkItem>
  /** Field-change history of a work item, raw from Azure DevOps. */
  getUpdates(org: string, project: string, id: number): Promise<unknown[]>
  /** Copy a run from Run mode to the release's existing plan; `mirrored` is false with no reason when there is no such plan. */
  tpMirrorResult(org: string, project: string, input: { planId?: number; release: string; testCaseId: number; outcome: 'Passed' | 'Failed'; comment: string; attachments: { name: string; dataBase64: string }[]; stepResults?: { stepId: string; outcome: 'Passed' | 'Failed' }[] }): Promise<{ mirrored: boolean; reason?: string }>
  // ----- Test Plans -----
  tpPlans(org: string, project: string, activeOnly?: boolean): Promise<TpPlan[]>
  /** Needs Basic + Test Plans access. */
  tpCreatePlan(org: string, project: string, input: NewPlanInput): Promise<TpPlan & { warning?: string }>
  tpSuites(org: string, project: string, planId: number): Promise<TpSuite[]>
  /** A static suite; with `requirementId` one that follows the requirement's Tested By links; with `tag` one holding every test case with that tag. */
  tpCreateSuite(org: string, project: string, planId: number, input: { parentId: number; name: string; requirementId?: number; tag?: string }): Promise<TpSuite>
  /** Close (Inactive) or reopen (Active) a plan; nothing in it is removed. */
  tpSetPlanState(org: string, project: string, planId: number, state: 'Active' | 'Inactive'): Promise<TpPlan>
  /** With configurations, one point per configuration instead of the suite's defaults. */
  tpAddCases(org: string, project: string, planId: number, suiteId: number, ids: number[], configurationIds?: number[]): Promise<void>
  tpRemoveCases(org: string, project: string, planId: number, suiteId: number, ids: number[]): Promise<void>
  tpConfigurations(org: string, project: string): Promise<TpConfiguration[]>
  tpPoints(org: string, project: string, planId: number, suiteId: number): Promise<TpPoint[]>
  tpUpdatePoints(org: string, project: string, planId: number, suiteId: number, updates: { id: number; outcome?: Markable; testerId?: string }[]): Promise<TpPoint[]>
  /** One test run over the points with a result each; aborted on Azure DevOps' side if it cannot be finished. */
  tpPublishRun(org: string, project: string, input: RunInput): Promise<{ runId: number; published: number }>
  /** The plan's test runs, newest first; each run's build number is the version it tested. */
  tpRuns(org: string, project: string, planId: number): Promise<TpRun[]>
  tpRunResults(org: string, project: string, runIds: number[]): Promise<TpResult[]>
  /** Recorded results by test case (its history across plans), plan or run, newest first. Read-only. */
  tpListResults(org: string, project: string, query: ResultQuery): Promise<TestResultSummary[]>
  /** One result with its step results and attachment list. */
  tpResult(org: string, project: string, runId: number, resultId: number): Promise<TestResultDetail>
  /** A result attachment's bytes, base64. */
  tpResultAttachment(org: string, project: string, runId: number, resultId: number, attachmentId: number): Promise<string>
  /** Download a result attachment to a path from pickSavePath. */
  tpSaveResultAttachment(org: string, project: string, runId: number, resultId: number, attachmentId: number, path: string): Promise<void>
  /** A project's work item types with their states (no field definitions). */
  workItemTypes(org: string, project: string): Promise<WorkItemType[]>
  searchWorkItems(org: string, project: string | null, text: string): Promise<WorkItem[]>
  getWorkItem(org: string, project: string, id: number): Promise<WorkItem>
  getChildren(org: string, project: string, id: number): Promise<WorkItem[]>
  getComments(org: string, project: string, id: number): Promise<Comment[]>
  /** The project's area tree (modules), raw from Azure DevOps. */
  getAreaTree(org: string, project: string): Promise<AreaNode>
  /** Add a module under `parent` (path below the project root, '' for the root). */
  createArea(org: string, project: string, parent: string, name: string): Promise<AreaNode>
  /** The areas a team's board shows. */
  teamAreas(org: string, project: string, team: string): Promise<{ path: string; includeChildren: boolean }[]>

  createWorkItem(org: string, project: string, type: string, fields: Record<string, unknown>, parentId: number | null): Promise<WorkItem>
  updateWorkItem(org: string, project: string, id: number, rev: number | null, fields: Record<string, unknown>): Promise<WorkItem>
  setParent(org: string, project: string, id: number, parentId: number | null): Promise<WorkItem>
  deleteWorkItem(org: string, project: string, id: number): Promise<void>
  addComment(org: string, project: string, id: number, text: string): Promise<Comment>

  /** Returns a data: URL for an Azure DevOps attachment, fetched with the user's token. */
  fetchAttachment(org: string, url: string): Promise<string>
  /** Upload a file as a work item attachment; the returned URL can be an image source in rich text. */
  uploadAttachment(org: string, project: string, fileName: string, dataBase64: string): Promise<{ id: string; url: string }>

  cacheGet<T>(key: string): Promise<CacheEntry<T> | null>
  cacheSet(key: string, value: unknown): Promise<void>
  cacheClear(): Promise<void>

  readCsv(path: string): Promise<CsvData>
  writeTextFile(path: string, content: string): Promise<void>
  importWorkItems(org: string, project: string, rows: ImportRow[]): Promise<ImportResult[]>

  // ----- Wiki -----
  /** The project's wikis, its own project wiki first. `version` below is a code wiki's branch (null otherwise). */
  wikiList(org: string, project: string): Promise<Wiki[]>
  /** Create the project wiki, for a project that has none. */
  wikiCreate(org: string, project: string, projectId: string): Promise<Wiki>
  wikiTree(org: string, project: string, wikiId: string, version: string | null): Promise<WikiPageNode>
  wikiPage(org: string, project: string, wikiId: string, path: string, version: string | null): Promise<WikiPage>
  /** Save an edited page; fails if someone else saved it after `pageVersion` was read. */
  wikiSave(org: string, project: string, wikiId: string, path: string, content: string, pageVersion: string, version: string | null): Promise<{ path: string; version: string | null }>
  wikiCreatePage(org: string, project: string, wikiId: string, parent: string, name: string, content: string, version: string | null): Promise<{ path: string; version: string | null }>
  /** Upload an image into the wiki's .attachments folder; `path` goes in the markdown. */
  wikiUploadAttachment(org: string, project: string, wikiId: string, fileName: string, dataBase64: string, version: string | null): Promise<{ name: string; path: string }>
  /** An .attachments image as a data URL. */
  wikiAttachment(org: string, project: string, repoId: string, branch: string, path: string, root: string | null): Promise<string>
  wikiSearch(org: string, project: string, text: string): Promise<WikiSearchResult>
  /** Pages changed on the wiki's branch since an ISO time, newest first, each once. `root` is a code wiki's folder. */
  wikiChanges(org: string, project: string, repoId: string, branch: string, root: string | null, since: string): Promise<WikiChange[]>
  /** Work items for a live block; `team` is needed for iteration "current". */
  wikiFindItems(org: string, project: string, team: string | null, filter: ItemFilter): Promise<FoundItems>

  // ----- Pull requests -----
  prListRepos(org: string, project: string): Promise<Repo[]>
  /** A repository's tag names ("v1.4.0"), offered as versions to test. Needs Code (Read). */
  gitTags(org: string, repoId: string): Promise<string[]>
  /** What is set up for git-tools versioning in a repository; read only. */
  versioningFacts(org: string, projectId: string, project: string, repoId: string, workflowPath: string, secureFile: string): Promise<VersioningFacts>
  /** One versioning setup change, made only after the user confirms it. */
  versioningFix(org: string, projectId: string, project: string, repoId: string, fix: VersioningFix): Promise<Record<string, unknown>>
  /** An empty project lists across the whole organization. */
  prList(org: string, project: string, status: string, opts?: { creatorId?: string; reviewerId?: string; repoId?: string; top?: number }): Promise<PullRequest[]>
  prDetail(org: string, projectId: string, repoId: string, prId: number): Promise<PrDetail>
  prWorkItemIds(org: string, repoId: string, prId: number): Promise<number[]>
  /** Work items linked to the source branch, its commits, or named as "#123" in its commit messages. */
  prBranchWorkItems(org: string, projectId: string, repoId: string, source: string, target: string): Promise<BranchWorkItem[]>
  /** Link a work item to a pull request, or remove the link. */
  prLinkWorkItem(org: string, projectId: string, repoId: string, prId: number, workItemId: number, linked: boolean): Promise<void>
  prChanges(org: string, repoId: string, prId: number, iteration: number, compareTo?: number): Promise<{ changeEntries: import('./pr/types').ChangeEntry[] }>
  prThreads(org: string, repoId: string, prId: number): Promise<Thread[]>
  prCreateThread(org: string, repoId: string, prId: number, body: unknown): Promise<Thread>
  prReply(org: string, repoId: string, prId: number, threadId: number, parentId: number, content: string): Promise<import('./pr/types').Comment>
  prUpdateThread(org: string, repoId: string, prId: number, threadId: number, body: unknown): Promise<Thread>
  prUpdateComment(org: string, repoId: string, prId: number, threadId: number, commentId: number, content: string): Promise<import('./pr/types').Comment>
  prDeleteComment(org: string, repoId: string, prId: number, threadId: number, commentId: number): Promise<void>
  prVote(org: string, repoId: string, prId: number, reviewerId: string, vote: number): Promise<unknown>
  prAddReviewer(org: string, repoId: string, prId: number, reviewerId: string, required: boolean): Promise<unknown>
  prRemoveReviewer(org: string, repoId: string, prId: number, reviewerId: string): Promise<void>
  prUpdate(org: string, repoId: string, prId: number, body: unknown): Promise<PullRequest>
  prCreate(org: string, repoId: string, body: unknown): Promise<PullRequest>
  prBranches(org: string, repoId: string): Promise<{ name: string; objectId: string }[]>
  prGet(org: string, repoId: string, prId: number): Promise<PullRequest>
  prChecks(org: string, projectId: string, repoId: string, prId: number): Promise<Pick<PrDetail, 'statuses' | 'policies'>>
  /** Create a branch from `base` and link it to the work item; `linked` is false when only the link failed. */
  prStartBranch(org: string, projectId: string, repoId: string, name: string, base: string, workItemId: number): Promise<{ name: string; linked: boolean; linkError?: string | null }>
  prFile(org: string, repoId: string, path: string, commit: string): Promise<string | null>
  prProjectMembers(org: string, projectId: string): Promise<Identity[]>

  // ----- Meeting rooms (Teamup) -----
  /** Whether this build has a Teamup API key built in. */
  roomsHasKey(): Promise<boolean>
  roomsList(calendar: string): Promise<{ subcalendars: Room[] }>
  /** Dates are YYYY-MM-DD, both inclusive. */
  roomsEvents(calendar: string, startDate: string, endDate: string): Promise<{ events: Booking[] }>
  /** Raw custom field definitions; refused unless the calendar key has admin rights. */
  roomsFields(calendar: string): Promise<{ definitions?: unknown[] }>
  roomsBook(calendar: string, event: NewBooking): Promise<{ event: Booking }>
  roomsCancel(calendar: string, eventId: string, version?: string): Promise<void>

  // ----- Local tools -----
  gitCurrentBranch(repoPath: string): Promise<string>
  /** Fetch a branch from origin and check it out in the local repository. */
  gitCheckoutBranch(repoPath: string, branch: string): Promise<string>
  /** Runs git-tools; `onOutput` receives each line it prints while it runs. */
  runGitTools(repoPath: string, bin: string | null, args: string[], onOutput?: (line: ToolLine) => void): Promise<{ code: number; stdout: string; stderr: string; clipboard: string | null }>
  /** Stop the running git-tools; its runGitTools call then rejects with "cancelled". */
  cancelGitTools(): Promise<boolean>
  pickFolder(): Promise<string | null>

  pickCsvFile(): Promise<string | null>
  /** Ask for a file to open; the path may then be read with readTextFile. */
  pickOpenFile(filter: { name: string; extensions: string[] }): Promise<string | null>
  readTextFile(path: string): Promise<string>
  pickSavePath(defaultName: string, filter?: { name: string; extensions: string[] }): Promise<string | null>
  openUrl(url: string): Promise<void>
  onMenu(handler: (id: string) => void): () => void
  onImportProgress(handler: (r: ImportResult) => void): () => void
  showContextMenu(items: ContextMenuItem[]): Promise<void>
}

export interface ToolLine {
  stream: 'stdout' | 'stderr'
  text: string
}

export interface AreaNode {
  name: string
  /** Like "\\Contoso Mobile\\Area\\Audit". */
  path: string
  children?: AreaNode[]
}

export interface ContextMenuItem {
  id?: string
  label?: string
  enabled?: boolean
  separator?: boolean
  action?: () => void
  submenu?: ContextMenuItem[]
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let impl: Api | null = null

// Calls that change something in Azure DevOps; while one is out, the app shows it is working.
const MUTATING = /^(add|remove|create|update|set|delete|import|upload|tpMirror|tp(CreatePlan|CreateSuite|AddCases|RemoveCases|UpdatePoints|PublishRun|SetPlanState)$|roomsBook|roomsCancel|wiki(Create|Save|CreatePage|UploadAttachment)$|pr(CreateThread|Reply|UpdateThread|UpdateComment|DeleteComment|Vote|AddReviewer|RemoveReviewer|Update|Create|LinkWorkItem|StartBranch)$)/

const tracked = (inner: Api): Api =>
  new Proxy(inner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || typeof value !== 'function' || !MUTATING.test(key)) return value
      return (...args: unknown[]) => {
        const out = value.apply(target, args)
        return out instanceof Promise ? useUiStore.getState().trackPending(out) : out
      }
    },
  })

export async function loadApi(): Promise<Api> {
  if (impl) return impl
  if (isTauri) {
    const mod = await import('./api.tauri')
    impl = tracked(mod.tauriApi)
  } else {
    const mod = await import('./api.mock')
    impl = tracked(mod.mockApi)
  }
  return impl
}

export function api(): Api {
  if (!impl) throw new Error('API not loaded yet')
  return impl
}
