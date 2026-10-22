import { create } from 'zustand'
import { api } from '@/lib/api'
import type { ChangeEntry, CompletionOptions, PrDetail, PullRequest, Repo, Thread } from '@/lib/pr/types'
import { errorMessage, isAppError } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

export type PrTab = 'review' | 'mine' | 'active' | 'closed'
export type DetailTab = 'overview' | 'files' | 'discussion'

interface FileState {
  path: string
  originalPath?: string
  changeType: string
  oldText: string | null
  newText: string | null
  binary: boolean
  loading: boolean
  error?: string
}

interface PrState {
  /** 'all' or a project id */
  scope: string
  members: Record<string, import('@/lib/types').Identity[]>
  repos: Repo[]
  tab: PrTab
  repoFilter: string | null
  search: string
  list: PullRequest[]
  listLoading: boolean
  listError: string | null
  /** Some projects could not be listed; the rest are shown. */
  listWarning: string | null
  /** Waiting on my vote within the current scope (the Review tab badge). */
  scopeWaiting: number
  /** Waiting on my vote across every project (the sidebar badge), independent of the scope picker. */
  counts: { review: number }
  countsError: string | null
  /** Active pull requests I wrote or review, across the organization. */
  involved: PullRequest[]
  involvedAt: number | null
  /** Linked work item ids per pull request, keyed "repoId:prId". */
  prItems: Record<string, number[]>
  selected: { repoId: string; prId: number; projectId: string; projectName: string } | null
  detail: PrDetail | null
  detailLoading: boolean
  detailTab: DetailTab
  changes: ChangeEntry[]
  changesLoading: boolean
  files: Record<string, FileState>
  activeFile: string | null
  busy: boolean

  init(): Promise<void>
  setScope(scope: string): void
  loadMembers(projectId: string): Promise<void>
  /** Fetch a project's repositories if the list scope has not loaded them yet. */
  loadRepos(projectId: string): Promise<void>
  setTab(t: PrTab): void
  setRepoFilter(id: string | null): void
  setSearch(s: string): void
  loadList(opts?: { silent?: boolean }): Promise<void>
  /** Refresh the organization-wide pull requests I am involved in, the sidebar count and their work item links. */
  loadInvolved(): Promise<void>
  open(pr: PullRequest): Promise<void>
  close(): void
  reload(): Promise<void>
  setDetailTab(t: DetailTab): void
  loadChanges(): Promise<void>
  openFile(path: string): Promise<void>

  vote(vote: number): Promise<void>
  addReviewer(id: string, required: boolean): Promise<void>
  removeReviewer(id: string): Promise<void>
  comment(content: string, ctx?: { filePath: string; line: number; side: 'left' | 'right'; endLine?: number }): Promise<void>
  reply(threadId: number, parentId: number, content: string): Promise<void>
  setThreadStatus(threadId: number, status: Thread['status']): Promise<void>
  editComment(threadId: number, commentId: number, content: string): Promise<void>
  deleteComment(threadId: number, commentId: number): Promise<void>
  complete(opts: CompletionOptions): Promise<boolean>
  setAutoComplete(opts: CompletionOptions | null): Promise<void>
  abandon(): Promise<void>
  reactivate(): Promise<void>
  setDraft(draft: boolean): Promise<void>
  updateTitleDescription(title: string, description: string): Promise<void>
  /** Link a work item to the open pull request, or remove the link. */
  linkWorkItem(workItemId: number, linked: boolean): Promise<void>
  create(repoId: string, body: { title: string; description: string; sourceRefName: string; targetRefName: string; isDraft: boolean; reviewers: { id: string; isRequired: boolean }[]; workItemIds: number[] }): Promise<PullRequest | null>
}

const read = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb } catch { return fb } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

function ctx() {
  const a = useAppStore.getState()
  return { org: a.activeOrg, me: a.account(), projects: a.projects }
}

/** Projects covered by the current scope. */
function scopedProjects(scope: string) {
  const { projects } = ctx()
  return scope === 'all' ? projects : projects.filter((p) => p.id === scope)
}

/** Whether this organization answers the organization-wide pull request list; null until tried. */
let orgWide: boolean | null = null
let involvedLoading: string | null = null
/** Bumped per list request, so a slow answer for a tab or scope the user already left is dropped. */
let listSeq = 0
/** When the user last left the Pull Requests view; an open pull request older than STALE_MS is closed on return. */
let leftAt: number | null = null
const STALE_MS = 15 * 60_000

/** Whether the open pull request is still the one a request was made for. */
const sameSelection = (a: { repoId: string; prId: number } | null, b: { repoId: string; prId: number }) => a?.prId === b.prId && a.repoId === b.repoId
const prKey = (p: PullRequest) => `${p.repository.id}:${p.pullRequestId}`
const byCreated = (a: PullRequest, b: PullRequest) => (b.creationDate > a.creationDate ? 1 : -1)
const byClosed = (a: PullRequest, b: PullRequest) => ((b.closedDate ?? b.creationDate) > (a.closedDate ?? a.creationDate) ? 1 : -1)
const isReviewer = (p: PullRequest, meId?: string) => p.reviewers.some((r) => r.id === meId)
/** Not a draft, I am a reviewer, and I have not voted yet. */
export const waitsOnMe = (p: PullRequest, meId?: string) => !p.isDraft && (p.reviewers.find((r) => r.id === meId)?.vote ?? 1) === 0

/** Errors that say the endpoint itself is not available, as opposed to a network or sign-in problem. */
const unsupported = (e: unknown) => isAppError(e) && ['not_found', 'validation'].includes(e.kind)

/**
 * Pull requests in the given projects. For every project at once, one organization-wide call is tried first;
 * otherwise one call per project, where a failing project is reported instead of silently showing nothing.
 */
async function listAcross(org: string, projects: { name: string }[], wholeOrg: boolean, status: string, opts: { top: number; reviewerId?: string; creatorId?: string }) {
  if (wholeOrg && orgWide !== false) {
    try {
      const list = await api().prList(org, '', status, opts)
      orgWide = true
      return { list, failed: [] as string[] }
    } catch (e) {
      if (!unsupported(e)) throw e
      orgWide = false
    }
  }
  const failed: string[] = []
  let firstError: unknown = null
  const lists = await mapLimit(projects, 4, (p) => api().prList(org, p.name, status, opts).catch((e) => { failed.push(p.name); firstError ??= e; return [] as PullRequest[] }))
  if (projects.length > 0 && failed.length === projects.length) throw firstError
  return { list: lists.flat(), failed }
}

const failedNote = (failed: string[]) => failed.length === 0 ? null : `Could not load pull requests from ${failed.length > 3 ? `${failed.slice(0, 3).join(', ')} and ${failed.length - 3} more` : failed.join(', ')}.`

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

/** Wait for Azure DevOps to finish a completion, then show what it holds; gives up after about half a minute. */
async function settleCompletion(sel: { repoId: string; prId: number; projectId: string }) {
  const st = usePrStore.getState
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, attempt < 4 ? 1500 : 3000))
    const { org } = ctx()
    if (!org) return
    let detail: PrDetail
    try { detail = await api().prDetail(org, sel.projectId, sel.repoId, sel.prId) } catch { continue }
    if (detail.pr.status === 'active' && attempt < 9) continue
    if (st().selected?.prId === sel.prId) usePrStore.setState({ detail })
    void st().loadList({ silent: true })
    void st().loadInvolved()
    if (detail.pr.status === 'active') {
      useUiStore.getState().toast({ kind: 'info', title: `!${sel.prId} is still merging`, detail: detail.pr.mergeStatus === 'conflicts' ? 'Azure DevOps found merge conflicts.' : 'Azure DevOps has not finished the merge yet; refresh in a moment.' })
    }
    return
  }
}

export const usePrStore = create<PrState>((set, get) => ({
  scope: read<string>('pr.scope', 'all'),
  members: {},
  repos: [],
  tab: ((t) => (t === 'completed' || t === 'abandoned' ? 'closed' : t))(read<string>('pr.tab', 'review')) as PrTab,
  repoFilter: null,
  search: '',
  list: [],
  listLoading: false,
  listError: null,
  listWarning: null,
  scopeWaiting: 0,
  counts: { review: 0 },
  countsError: null,
  involved: [],
  involvedAt: null,
  prItems: {},
  selected: null,
  detail: null,
  detailLoading: false,
  detailTab: 'overview',
  changes: [],
  changesLoading: false,
  files: {},
  activeFile: null,
  busy: false,

  init: async () => {
    const { org } = ctx()
    if (!org) return
    // An open pull request stays open: it may have been picked from My Work just before this view mounted.
    set({ list: [], repoFilter: null })
    void get().loadList()
    try {
      const lists = await mapLimit(scopedProjects(get().scope), 4, (p) => api().prListRepos(org, p.name).catch(() => [] as Repo[]))
      set({ repos: lists.flat().filter((r) => !r.isDisabled) })
    } catch (e) {
      set({ listError: errorMessage(e) })
    }
  },

  setScope: (scope) => { write('pr.scope', scope); get().close(); set({ scope, repoFilter: null }); void get().init() },

  loadRepos: async (projectId) => {
    const { org, projects } = ctx()
    const p = projects.find((x) => x.id === projectId)
    if (!org || !p || get().repos.some((r) => r.project?.id === projectId)) return
    try {
      const fresh = (await api().prListRepos(org, p.name)).filter((r) => !r.isDisabled)
      set((st) => ({ repos: [...st.repos.filter((r) => r.project?.id !== projectId), ...fresh] }))
    } catch { /* the picker just stays empty for that project */ }
  },

  loadMembers: async (projectId) => {
    const { org } = ctx()
    if (!org || get().members[projectId]) return
    try {
      const m = await api().prProjectMembers(org, projectId)
      set((st) => ({ members: { ...st.members, [projectId]: m } }))
    } catch { /* reviewers list just stays empty */ }
  },

  // The open pull request belongs to the list it was picked from, so a different list closes it.
  setTab: (tab) => { write('pr.tab', tab); get().close(); set({ tab }); void get().loadList() },
  setRepoFilter: (repoFilter) => { get().close(); set({ repoFilter }); void get().loadList() },
  setSearch: (search) => set({ search }),

  loadList: async (opts) => {
    const { org, me } = ctx()
    if (!org) return
    const { tab, repoFilter, scope } = get()
    const seq = ++listSeq
    const projects = scopedProjects(scope)
    const wholeOrg = scope === 'all'
    if (!opts?.silent) set({ listLoading: true, listError: null })
    try {
      // Review and Authored are filtered on the server, so a busy organization cannot push them past the cap.
      const reviewing = await listAcross(org, projects, wholeOrg, 'active', { top: 200, reviewerId: me?.userId })
      const failed = [...reviewing.failed]
      const notes: string[] = []
      const capped = (n: number, top: number, what: string) => { if (n >= top) notes.push(`Showing the newest ${top} ${what}.`) }
      const merge = (more: string[]) => failed.push(...more.filter((n) => !failed.includes(n)))
      let list: PullRequest[]
      if (tab === 'review') {
        // Waiting on my vote first, then the rest I review; newest first within each.
        list = reviewing.list.filter((p) => isReviewer(p, me?.userId)).sort((a, b) => Number(waitsOnMe(b, me?.userId)) - Number(waitsOnMe(a, me?.userId)) || byCreated(a, b))
      } else if (tab === 'mine') {
        const authored = await listAcross(org, projects, wholeOrg, 'active', { top: 200, creatorId: me?.userId })
        merge(authored.failed)
        list = authored.list.filter((p) => p.createdBy.id === me?.userId).sort(byCreated)
      } else if (tab === 'active') {
        const top = wholeOrg ? 500 : 200
        const active = await listAcross(org, projects, wholeOrg, 'active', { top })
        merge(active.failed)
        if (wholeOrg && orgWide) capped(active.list.length, top, 'active pull requests')
        list = [...active.list].sort(byCreated)
      } else {
        const [doneTop, droppedTop] = wholeOrg ? [300, 100] : [100, 50]
        const [done, dropped] = await Promise.all([
          listAcross(org, projects, wholeOrg, 'completed', { top: doneTop }),
          listAcross(org, projects, wholeOrg, 'abandoned', { top: droppedTop }),
        ])
        merge(done.failed); merge(dropped.failed)
        if (wholeOrg && orgWide) { capped(done.list.length, doneTop, 'completed'); capped(dropped.list.length, droppedTop, 'abandoned') }
        list = [...done.list, ...dropped.list].sort(byClosed)
      }
      if (seq !== listSeq) return
      if (repoFilter) list = list.filter((p) => p.repository.id === repoFilter)
      const scopeWaiting = reviewing.list.filter((p) => waitsOnMe(p, me?.userId)).length
      set({ list, listLoading: false, listWarning: [failedNote(failed), ...notes].filter(Boolean).join(' ') || null, scopeWaiting })
    } catch (e) {
      if (seq === listSeq) set({ listLoading: false, listError: errorMessage(e) })
    }
  },

  loadInvolved: async () => {
    const { org, me, projects } = ctx()
    if (!org || !me || projects.length === 0) return
    // Startup, the project list arriving, focus and the timer can all ask at once; one request at a time is enough.
    if (involvedLoading === org) return
    involvedLoading = org
    try {
      const [asReviewer, asAuthor] = await Promise.all([
        listAcross(org, projects, true, 'active', { top: 200, reviewerId: me.userId }),
        listAcross(org, projects, true, 'active', { top: 200, creatorId: me.userId }),
      ])
      if (ctx().org !== org) return
      // The two lists overlap where I both wrote and review a pull request.
      const seen = new Set<string>()
      const involved = [...asReviewer.list, ...asAuthor.list].filter((p) => {
        const k = prKey(p)
        if (seen.has(k) || !(isReviewer(p, me.userId) || p.createdBy.id === me.userId)) return false
        seen.add(k)
        return true
      })
      const failed = [...new Set([...asReviewer.failed, ...asAuthor.failed])]
      set({ involved, involvedAt: Date.now(), counts: { review: involved.filter((p) => waitsOnMe(p, me.userId)).length }, countsError: failedNote(failed) })

      // Work item links rarely change, so each pull request is asked once; the newest 40 cover what matters.
      const missing = involved.filter((p) => !get().prItems[prKey(p)]).sort(byCreated).slice(0, 40)
      const links = await mapLimit(missing, 4, (p) => api().prWorkItemIds(org, p.repository.id, p.pullRequestId).catch(() => null))
      if (ctx().org !== org) return
      const add: Record<string, number[]> = {}
      missing.forEach((p, i) => { const l = links[i]; if (l) add[prKey(p)] = l })
      if (Object.keys(add).length) set((st) => ({ prItems: { ...st.prItems, ...add } }))
    } catch (e) {
      if (ctx().org === org) set({ countsError: errorMessage(e), involvedAt: Date.now() })
    } finally {
      if (involvedLoading === org) involvedLoading = null
    }
  },

  open: async (pr) => {
    const { org } = ctx()
    if (!org) return
    const repoId = pr.repository.id
    const prId = pr.pullRequestId
    const projectId = pr.repository.project?.id ?? ''
    const projectName = pr.repository.project?.name ?? ''
    leftAt = null
    set({ selected: { repoId, prId, projectId, projectName }, detail: null, detailLoading: true, changes: [], changesLoading: false, files: {}, activeFile: null, detailTab: get().detailTab === 'files' ? 'files' : 'overview' })
    void get().loadMembers(projectId)
    try {
      const detail = await api().prDetail(org, projectId, repoId, prId)
      if (get().selected?.prId !== prId) return
      set({ detail, detailLoading: false })
      if (get().detailTab === 'files') void get().loadChanges()
    } catch (e) {
      set({ detailLoading: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not open pull request', detail: errorMessage(e) })
    }
  },

  close: () => set({ selected: null, detail: null, changes: [], changesLoading: false, files: {}, activeFile: null }),

  reload: async () => {
    const s = get().selected
    if (!s) return
    const { org } = ctx()
    if (!org) return
    try {
      const detail = await api().prDetail(org, s.projectId, s.repoId, s.prId)
      if (get().selected?.prId === s.prId) set({ detail, prItems: { ...get().prItems, [`${s.repoId}:${s.prId}`]: detail.workItems.map((w) => Number(w.id)) } })
      void get().loadList({ silent: true })
      void get().loadInvolved()
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Refresh failed', detail: errorMessage(e) })
    }
  },

  setDetailTab: (detailTab) => {
    set({ detailTab })
    if (detailTab === 'files' && get().changes.length === 0) void get().loadChanges()
  },

  loadChanges: async () => {
    const { org } = ctx()
    const { selected, detail } = get()
    if (!org || !selected || !detail) return
    const last = detail.iterations[detail.iterations.length - 1]
    if (!last) return
    set({ changesLoading: true })
    try {
      const res = await api().prChanges(org, selected.repoId, selected.prId, last.id, 0)
      if (!sameSelection(get().selected, selected)) return
      const entries = (res.changeEntries ?? []).filter((c) => c.item?.gitObjectType !== 'tree' && !c.item?.isFolder && c.item?.path)
      entries.sort((a, b) => (a.item.path ?? '').localeCompare(b.item.path ?? ''))
      set({ changes: entries, changesLoading: false })
      const first = entries[0]?.item.path
      if (first && !get().activeFile) void get().openFile(first)
    } catch (e) {
      if (!sameSelection(get().selected, selected)) return
      set({ changesLoading: false })
      useUiStore.getState().toast({ kind: 'error', title: 'Could not load changed files', detail: errorMessage(e) })
    }
  },

  openFile: async (path) => {
    const { org } = ctx()
    const { selected, detail, changes, files } = get()
    if (!org || !selected || !detail) return
    set({ activeFile: path })
    if (files[path] && !files[path].error) return
    const change = changes.find((c) => c.item.path === path)
    if (!change) return
    const last = detail.iterations[detail.iterations.length - 1]
    const base = last?.targetRefCommit?.commitId ?? detail.pr.lastMergeTargetCommit?.commitId ?? ''
    const head = last?.sourceRefCommit?.commitId ?? detail.pr.lastMergeSourceCommit?.commitId ?? ''
    const type = change.changeType.toLowerCase()
    const isAdd = type.includes('add')
    const isDelete = type.includes('delete')
    const oldPath = change.originalPath ?? path
    const binaryGuess = /\.(png|jpe?g|gif|bmp|ico|icns|webp|pdf|zip|gz|7z|jar|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|avi|heic|psd|bin|class|pyc)$/i.test(path)
    const fs: FileState = { path, originalPath: change.originalPath, changeType: change.changeType, oldText: null, newText: null, binary: binaryGuess, loading: !binaryGuess }
    set((s) => ({ files: { ...s.files, [path]: fs } }))
    if (binaryGuess) return
    try {
      const [oldText, newText] = await Promise.all([
        isAdd ? Promise.resolve(null) : api().prFile(org, selected.repoId, oldPath, base),
        isDelete ? Promise.resolve(null) : api().prFile(org, selected.repoId, path, head),
      ])
      const binary = (!isAdd && oldText === null) && (!isDelete && newText === null)
      if (!sameSelection(get().selected, selected)) return
      set((s) => ({ files: { ...s.files, [path]: { ...fs, oldText: oldText ?? '', newText: newText ?? '', binary, loading: false } } }))
    } catch (e) {
      if (!sameSelection(get().selected, selected)) return
      set((s) => ({ files: { ...s.files, [path]: { ...fs, loading: false, error: errorMessage(e) } } }))
    }
  },

  vote: async (vote) => {
    const { org, me } = ctx()
    const s = get().selected
    if (!org || !s || !me) return
    set({ busy: true })
    try {
      await api().prVote(org, s.repoId, s.prId, me.userId, vote)
      await get().reload()
      useUiStore.getState().toast({ kind: 'success', title: vote === 10 ? 'Approved' : vote === 5 ? 'Approved with suggestions' : vote === -5 ? 'Marked as waiting for author' : vote === -10 ? 'Rejected' : 'Vote reset' })
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not vote', detail: errorMessage(e) })
    } finally { set({ busy: false }) }
  },

  addReviewer: async (id, required) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try { await api().prAddReviewer(org, s.repoId, s.prId, id, required); await get().reload() } catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not add reviewer', detail: errorMessage(e) }) }
  },
  removeReviewer: async (id) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try { await api().prRemoveReviewer(org, s.repoId, s.prId, id); await get().reload() } catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not remove reviewer', detail: errorMessage(e) }) }
  },

  comment: async (content, c) => {
    const { org } = ctx(); const s = get().selected; const d = get().detail
    if (!org || !s || !d) return
    const body: Record<string, unknown> = { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 }
    if (c) {
      const start = { line: c.line, offset: 1 }
      const end = { line: c.endLine ?? c.line, offset: 1 }
      body.threadContext = c.side === 'right' ? { filePath: c.filePath, rightFileStart: start, rightFileEnd: end } : { filePath: c.filePath, leftFileStart: start, leftFileEnd: end }
      const last = d.iterations[d.iterations.length - 1]
      if (last) body.pullRequestThreadContext = { iterationContext: { firstComparingIteration: 1, secondComparingIteration: last.id } }
    }
    try {
      const t = await api().prCreateThread(org, s.repoId, s.prId, body)
      set((st) => (st.detail ? { detail: { ...st.detail, threads: [...st.detail.threads, t] } } : {}))
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not post comment', detail: errorMessage(e) })
    }
  },

  reply: async (threadId, parentId, content) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try {
      const c = await api().prReply(org, s.repoId, s.prId, threadId, parentId, content)
      set((st) => (st.detail ? { detail: { ...st.detail, threads: st.detail.threads.map((t) => (t.id === threadId ? { ...t, comments: [...t.comments, c] } : t)) } } : {}))
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not reply', detail: errorMessage(e) })
    }
  },

  setThreadStatus: async (threadId, status) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    const code: Record<string, number> = { active: 1, fixed: 2, wontFix: 3, closed: 4, byDesign: 5, pending: 6 }
    try {
      const t = await api().prUpdateThread(org, s.repoId, s.prId, threadId, { status: code[status ?? 'active'] ?? 1 })
      set((st) => (st.detail ? { detail: { ...st.detail, threads: st.detail.threads.map((x) => (x.id === threadId ? { ...x, status: t.status ?? status } : x)) } } : {}))
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not update thread', detail: errorMessage(e) })
    }
  },

  editComment: async (threadId, commentId, content) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try {
      const c = await api().prUpdateComment(org, s.repoId, s.prId, threadId, commentId, content)
      set((st) => (st.detail ? { detail: { ...st.detail, threads: st.detail.threads.map((t) => (t.id === threadId ? { ...t, comments: t.comments.map((x) => (x.id === commentId ? { ...x, ...c } : x)) } : t)) } } : {}))
    } catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not edit comment', detail: errorMessage(e) }) }
  },

  deleteComment: async (threadId, commentId) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try {
      await api().prDeleteComment(org, s.repoId, s.prId, threadId, commentId)
      set((st) => (st.detail ? { detail: { ...st.detail, threads: st.detail.threads.map((t) => (t.id === threadId ? { ...t, comments: t.comments.map((x) => (x.id === commentId ? { ...x, isDeleted: true, content: '' } : x)) } : t)) } } : {}))
    } catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not delete comment', detail: errorMessage(e) }) }
  },

  complete: async (opts) => {
    const { org } = ctx(); const s = get().selected; const d = get().detail
    if (!org || !s || !d) return false
    set({ busy: true })
    try {
      const updated = await api().prUpdate(org, s.repoId, s.prId, { status: 'completed', lastMergeSourceCommit: d.pr.lastMergeSourceCommit, completionOptions: opts })
      // Azure DevOps merges in the background and reads the pull request as active for a few seconds,
      // so show it completed now and leave the active lists until the server catches up.
      const { me } = ctx()
      const key = `${s.repoId}:${s.prId}`
      set((st) => {
        const involved = st.involved.filter((p) => prKey(p) !== key)
        return {
          detail: st.selected?.prId === s.prId && st.detail ? { ...st.detail, pr: { ...st.detail.pr, ...updated, status: 'completed', closedDate: updated.closedDate ?? new Date().toISOString() } } : st.detail,
          list: st.tab === 'closed' ? st.list : st.list.filter((p) => prKey(p) !== key),
          involved,
          counts: { review: involved.filter((p) => waitsOnMe(p, me?.userId)).length },
          scopeWaiting: Math.max(0, st.scopeWaiting - (waitsOnMe(d.pr, me?.userId) ? 1 : 0)),
        }
      })
      useUiStore.getState().toast({ kind: 'success', title: `Pull request !${s.prId} completed` })
      void settleCompletion(s)
      return true
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not complete', detail: errorMessage(e) })
      return false
    } finally { set({ busy: false }) }
  },

  setAutoComplete: async (opts) => {
    const { org, me } = ctx(); const s = get().selected
    if (!org || !s || !me) return
    set({ busy: true })
    try {
      const body = opts ? { autoCompleteSetBy: { id: me.userId }, completionOptions: opts } : { autoCompleteSetBy: { id: '00000000-0000-0000-0000-000000000000' } }
      await api().prUpdate(org, s.repoId, s.prId, body)
      await get().reload()
      useUiStore.getState().toast({ kind: 'success', title: opts ? 'Auto-complete set' : 'Auto-complete cancelled', detail: opts ? 'It will complete once all policies pass.' : undefined })
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not set auto-complete', detail: errorMessage(e) })
    } finally { set({ busy: false }) }
  },

  abandon: async () => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    set({ busy: true })
    try { await api().prUpdate(org, s.repoId, s.prId, { status: 'abandoned' }); await get().reload(); useUiStore.getState().toast({ kind: 'info', title: 'Pull request abandoned' }) }
    catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not abandon', detail: errorMessage(e) }) }
    finally { set({ busy: false }) }
  },
  reactivate: async () => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    set({ busy: true })
    try { await api().prUpdate(org, s.repoId, s.prId, { status: 'active' }); await get().reload() }
    catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not reactivate', detail: errorMessage(e) }) }
    finally { set({ busy: false }) }
  },
  setDraft: async (draft) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try { await api().prUpdate(org, s.repoId, s.prId, { isDraft: draft }); await get().reload() }
    catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not change draft state', detail: errorMessage(e) }) }
  },
  updateTitleDescription: async (title, description) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try { await api().prUpdate(org, s.repoId, s.prId, { title, description }); await get().reload(); useUiStore.getState().toast({ kind: 'success', title: 'Saved' }) }
    catch (e) { useUiStore.getState().toast({ kind: 'error', title: 'Could not save', detail: errorMessage(e) }) }
  },

  linkWorkItem: async (workItemId, linked) => {
    const { org } = ctx(); const s = get().selected
    if (!org || !s) return
    try {
      await api().prLinkWorkItem(org, s.projectId, s.repoId, s.prId, workItemId, linked)
      await get().reload()
      useUiStore.getState().toast({ kind: 'success', title: linked ? `Linked #${workItemId}` : `Unlinked #${workItemId}` })
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: linked ? 'Could not link work item' : 'Could not unlink work item', detail: errorMessage(e) })
    }
  },

  create: async (repoId, body) => {
    const { org } = ctx()
    if (!org) return null
    set({ busy: true })
    try {
      const pr = await api().prCreate(org, repoId, { title: body.title, description: body.description, sourceRefName: body.sourceRefName, targetRefName: body.targetRefName, isDraft: body.isDraft, reviewers: body.reviewers, workItemRefs: body.workItemIds.map((id) => ({ id: String(id) })) })
      useUiStore.getState().toast({ kind: 'success', title: `Created pull request !${pr.pullRequestId}` })
      await get().loadList({ silent: true })
      await get().open(pr)
      return pr
    } catch (e) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not create pull request', detail: errorMessage(e) })
      return null
    } finally { set({ busy: false }) }
  },
}))

// Coming back to Pull Requests after a while: an old selection is closed, a recent one is refreshed.
useUiStore.subscribe((st, prev) => {
  if (st.view === prev.view) return
  if (prev.view === 'prs') { leftAt = Date.now(); return }
  if (st.view !== 'prs' || leftAt === null) return
  const away = Date.now() - leftAt
  leftAt = null
  const pr = usePrStore.getState()
  if (away > STALE_MS) { pr.close(); void pr.loadList({ silent: true }) }
  else if (pr.selected) void pr.reload()
})

// Reset when the organization changes; the project list may also arrive after the view opened.
useAppStore.subscribe((st, prev) => {
  if (st.activeOrg !== prev.activeOrg) {
    orgWide = null
    usePrStore.setState({ repos: [], list: [], selected: null, detail: null, members: {}, involved: [], prItems: {}, counts: { review: 0 }, countsError: null, scopeWaiting: 0, listWarning: null })
    void usePrStore.getState().loadInvolved()
    if (useUiStore.getState().view === 'prs') void usePrStore.getState().init()
  } else if (st.projects !== prev.projects) {
    // The sidebar count needs the project list when the organization-wide call is not available.
    if (prev.projects.length === 0) void usePrStore.getState().loadInvolved()
    if (useUiStore.getState().view === 'prs' && usePrStore.getState().list.length === 0) void usePrStore.getState().init()
  }
})
