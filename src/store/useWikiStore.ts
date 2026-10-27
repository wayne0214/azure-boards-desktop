import { create } from 'zustand'
import { api } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import type { Booking } from '@/lib/rooms/types'
import { errorMessage, isAppError, type Identity, type Project, type WorkItemType } from '@/lib/types'
import { actionOwner, linkTasks, newActions, parseActions, taskTitle } from '@/lib/wiki/actions'
import { isDone } from '@/lib/wiki/drafts'
import { appendToSection, childPages, flattenPages, mentionedIds, pageNameProblem, pageTitle, parentPath, sectionText, wikiBranch, wikiVersion } from '@/lib/wiki/pages'
import { fromWikiMentions, mentionsOf, toWikiMentions } from '@/lib/wiki/people'
import { isoDay, meetingNotes, MEETINGS } from '@/lib/wiki/templates'
import type { Wiki, WikiChange, WikiPage, WikiPageNode, WikiSearchResult } from '@/lib/wiki/types'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, v: string) => { try { localStorage.setItem(key, v) } catch { /* ignore */ } }

/** A work item named as "#123" on a page, as its link shows it. */
export interface MentionedItem { title: string; type: string; state: string; done: boolean }

/** A page that mentions me, changed by someone else lately. */
export interface WikiMention { path: string; by: string | null; date: string }

/** How far back "changed since you last looked" reaches, and where it starts the first time. */
const CHANGES_DAYS = 14
const FIRST_LOOK_DAYS = 3

interface WikiState {
  project: Project | null
  wikis: Wiki[]
  wikiId: string | null
  tree: WikiPageNode | null
  loading: boolean
  error: string | null
  path: string | null
  page: WikiPage | null
  pageLoading: boolean
  pageError: string | null
  /** The text being edited; null when not editing. Kept when leaving the view, so nothing typed is lost. */
  draft: string | null
  /** The draft as editing started: what "unchanged" means, even if the people list arrives later. */
  clean: string | null
  /** A new page being written: nothing is in the wiki until it is saved. */
  creating: { parent: string; name: string; back: string | null } | null
  saving: boolean
  search: { text: string; result: WikiSearchResult | null; loading: boolean } | null
  /** Work items mentioned on pages; null while loading or when not found. */
  mentions: Record<number, MentionedItem | null>
  /** People in the project, for @mentions and action owners. */
  people: Identity[]
  /** Pages changed lately, newest first; null until loaded. */
  changes: WikiChange[] | null
  /** When I last opened each page (ISO), and where "unseen" starts for pages I never opened. */
  seen: Record<string, string>
  since: string | null
  mentionsOfMe: WikiMention[]
  makingTasks: boolean

  load(project: Project): Promise<void>
  selectWiki(id: string): Promise<void>
  reloadTree(): Promise<void>
  open(path: string): Promise<void>
  edit(): void
  setDraft(text: string): void
  cancelEdit(): Promise<void>
  save(): Promise<boolean>
  /** Start a new page under `parent`; it is written to the wiki on Save. */
  createPage(parent: string, name: string, content?: string): Promise<boolean>
  createWiki(): Promise<void>
  runSearch(text: string): Promise<void>
  clearSearch(): void
  loadMentions(ids: number[]): void
  /** Open actions on the page ("- [ ] @Name …") without a work item become Tasks, linked back on their lines. */
  createTasks(): Promise<number>
  /** Add "- #id" under the page's "## Became" heading, e.g. the requirement a piece of feedback became. */
  linkItem(id: number, heading?: string): Promise<boolean>
  /** The notes page for a room booking: opened if it is there, else started from the template with last time's open actions. */
  notesFor(booking: Booking, room: string | null): Promise<void>
  /** Start meeting notes for a topic, with the open actions from the last meeting on it. */
  startMeeting(topic: string, opts?: { date?: string; time?: string | null; room?: string | null; organizer?: string | null }): Promise<boolean>
  /** Open a page from elsewhere in the app (a backlink, My Work, mini mode). */
  show(path: string, wikiId?: string | null): Promise<void>
  loadChanges(): Promise<void>
  /** For My Work and mini mode: changes in this project's wiki, loading it when needed. */
  refreshFor(project: Project): Promise<void>
}

const wiki = (s: Pick<WikiState, 'wikis' | 'wikiId'>) => s.wikis.find((w) => w.id === s.wikiId) ?? null
const org = () => useAppStore.getState().activeOrg ?? ''
const toast = (t: Parameters<ReturnType<typeof useUiStore.getState>['toast']>[0]) => useUiStore.getState().toast(t)
const isConflict = (e: unknown) => isAppError(e) && (e as { kind?: string }).kind === 'conflict'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The signed-in person, as wiki changes name them. */
const isMe = (c: WikiChange) => {
  const me = useAppStore.getState().account()
  return !!me && (c.author === me.userName || (!!c.authorEmail && c.authorEmail.toLowerCase() === me.userName?.toLowerCase()))
}

/** Changed by someone else after I last looked at that page. */
export const isUnseen = (s: Pick<WikiState, 'seen' | 'since'>, c: WikiChange) => !isMe(c) && Date.parse(c.date) > Date.parse(s.seen[c.path] ?? s.since ?? c.date)
export const unseenChanges = (s: Pick<WikiState, 'changes' | 'seen' | 'since'>) => (s.changes ?? []).filter((c) => isUnseen(s, c))

// Work item types per project, to tell whether a mentioned item is finished.
const typesCache = new Map<string, Promise<WorkItemType[]>>()
const typesOf = (project: string) => {
  const key = `${org()}/${project}`
  if (!typesCache.has(key)) typesCache.set(key, api().workItemTypes(org(), project).catch(() => { typesCache.delete(key); return [] }))
  return typesCache.get(key)!
}

// Page text read for mentions, by path and change time, so a refresh reads only what changed.
const mentionScan = new Map<string, boolean>()

export const useWikiStore = create<WikiState>((set, get) => {
  /** The page's text as the editor shows it: mentions as names. */
  const editable = (content: string) => fromWikiMentions(content, get().people)

  /** Unsaved edits are only dropped when the user says so. */
  const canLeave = async () => {
    const { draft, clean, creating } = get()
    if (draft === null || (!creating && draft === clean)) return true
    return confirmAsync('Your changes to this page are not saved. Discard them?', { title: 'Discard changes?', okLabel: 'Discard', danger: true })
  }

  const markSeen = (w: Wiki, path: string) => {
    const seen = { ...get().seen, [path]: new Date().toISOString() }
    const kept = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 500))
    set({ seen: kept })
    write(`wiki.seen.${w.id}`, JSON.stringify(kept))
  }

  /** Remembered per wiki: what I opened when, and where "unseen" starts. */
  const restoreSeen = (w: Wiki | null) => {
    if (!w) return set({ seen: {}, since: null })
    let seen: Record<string, string> = {}
    try { seen = JSON.parse(read(`wiki.seen.${w.id}`) ?? '{}') } catch { /* fresh */ }
    let since = read(`wiki.since.${w.id}`)
    if (!since) {
      since = new Date(Date.now() - FIRST_LOOK_DAYS * 86400000).toISOString()
      write(`wiki.since.${w.id}`, since)
    }
    set({ seen, since })
  }

  /** The project to show a page in: the one open in the app, else the one whose wiki was open last (selected again). */
  const wikiProject = async (): Promise<Project | null> => {
    const app = useAppStore.getState()
    const p = app.selectedProject ?? get().project
    if (p && app.selectedProject?.id !== p.id) await app.selectProject(p)
    return p
  }

  /** Parents a new page needs, created top-down with just a heading. */
  const ensureParents = async (w: Wiki, project: Project, parent: string) => {
    const have = new Set(flattenPages(get().tree))
    const missing: string[] = []
    for (let p = parent; p !== '/' && !have.has(p); p = parentPath(p)) missing.unshift(p)
    for (const p of missing) {
      try {
        await api().wikiCreatePage(org(), project.name, w.id, parentPath(p), pageTitle(p), `# ${pageTitle(p)}\n`, wikiVersion(w))
      } catch (e) {
        if (!isConflict(e)) throw e
      }
    }
  }

  /**
   * Save `make(text)` over the page at `path`, read fresh from the wiki (the user may have moved on to another page);
   * on someone else's save, read it again and retry once.
   */
  const rewrite = async (path: string, make: (content: string) => string): Promise<void> => {
    const { project } = get()
    const w = wiki(get())
    if (!project || !w) throw new Error('The wiki is not open.')
    let page = await api().wikiPage(org(), project.name, w.id, path, wikiVersion(w))
    for (let attempt = 0; ; attempt++) {
      const next = make(page.content)
      try {
        const res = await api().wikiSave(org(), project.name, w.id, page.path, next, page.version ?? '', wikiVersion(w))
        if (get().path === path && get().draft === null) set({ page: { ...page, content: next, version: res.version } })
        return
      } catch (e) {
        if (attempt > 0 || !isConflict(e)) throw e
        page = await api().wikiPage(org(), project.name, w.id, page.path, wikiVersion(w))
      }
    }
  }

  return {
    project: null,
    wikis: [],
    wikiId: null,
    tree: null,
    loading: false,
    error: null,
    path: null,
    page: null,
    pageLoading: false,
    pageError: null,
    draft: null,
    clean: null,
    creating: null,
    saving: false,
    search: null,
    mentions: {},
    people: [],
    changes: null,
    seen: {},
    since: null,
    mentionsOfMe: [],
    makingTasks: false,

    load: async (project) => {
      if (get().project?.id === project.id && get().tree) return
      if (get().project && get().project?.id !== project.id && !(await canLeave())) return
      set({ project, wikis: [], wikiId: null, tree: null, loading: true, error: null, path: null, page: null, pageError: null, draft: null, clean: null, creating: null, search: null, mentions: {}, people: [], changes: null, mentionsOfMe: [] })
      void api().prProjectMembers(org(), project.id).then((people) => { if (get().project?.id === project.id) set({ people }) }).catch(() => undefined)
      try {
        const wikis = await api().wikiList(org(), project.name)
        if (get().project?.id !== project.id) return
        const remembered = read(`wiki.id.${project.id}`)
        const wikiId = wikis.find((w) => w.id === remembered)?.id ?? wikis[0]?.id ?? null
        set({ wikis, wikiId })
        restoreSeen(wiki(get()))
        if (wikiId) {
          await get().reloadTree()
          void get().loadChanges()
        }
      } catch (e) {
        set({ error: errorMessage(e) })
      } finally {
        set({ loading: false })
      }
    },

    selectWiki: async (id) => {
      if (!(await canLeave())) return
      const p = get().project
      if (p) write(`wiki.id.${p.id}`, id)
      set({ wikiId: id, tree: null, path: null, page: null, draft: null, creating: null, search: null, changes: null, mentionsOfMe: [] })
      restoreSeen(wiki(get()))
      await get().reloadTree()
      void get().loadChanges()
    },

    reloadTree: async () => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return
      set({ loading: true, error: null })
      const stale = () => get().project?.id !== project.id || get().wikiId !== w.id
      try {
        const tree = await api().wikiTree(org(), project.name, w.id, wikiVersion(w))
        if (stale()) return
        set({ tree })
        if (get().creating) return
        const paths = flattenPages(tree)
        const cur = get().path
        const want = cur && paths.includes(cur) ? cur : read(`wiki.page.${w.id}`)
        const start = want && paths.includes(want) ? want : paths.find((p) => p === '/Home') ?? paths[0]
        if (start && start !== cur) await get().open(start)
      } catch (e) {
        if (!stale()) set({ error: errorMessage(e) })
      } finally {
        if (!stale()) set({ loading: false })
      }
    },

    open: async (path) => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return
      if (path === get().path && get().draft !== null) return
      if (path !== get().path && get().draft !== null && !(await canLeave())) return
      // The old page goes at once: an edit started now must not begin from it, or save it here.
      set({ path, page: path === get().path ? get().page : null, pageLoading: true, pageError: null, draft: null, creating: null })
      write(`wiki.page.${w.id}`, path)
      markSeen(w, path)
      try {
        const page = await api().wikiPage(org(), project.name, w.id, path, wikiVersion(w))
        // An edit started from the text shown meanwhile keeps that version, so a newer save is reported, not overwritten.
        if (get().path === path && get().draft === null) set({ page })
      } catch (e) {
        if (get().path === path) set({ page: null, pageError: errorMessage(e) })
      } finally {
        if (get().path === path) set({ pageLoading: false })
      }
    },

    edit: () => { const { page } = get(); if (page) { const text = editable(page.content); set({ draft: text, clean: text }) } },
    setDraft: (draft) => set({ draft }),
    cancelEdit: async () => {
      if (!(await canLeave())) return
      const back = get().creating?.back ?? null
      if (!get().creating) return set({ draft: null })
      set({ draft: null, creating: null, path: null, page: null })
      if (back) await get().open(back)
    },

    save: async () => {
      const { project, page, draft, clean, creating, people, path } = get()
      const w = wiki(get())
      if (!project || !w || !page || draft === null || get().saving) return false
      if (!creating && draft === clean) { set({ draft: null, clean: null }); return true }
      const content = toWikiMentions(draft, people)
      set({ saving: true })
      // Still on this page, editing: keep anything typed while saving, now against the saved version.
      const after = (saved: WikiPage) => {
        if (get().path !== path) return
        const now = get().draft
        set(now !== null && now !== draft ? { page: saved, clean: draft, creating: null } : { page: saved, draft: null, clean: null, creating: null })
      }
      try {
        if (creating) {
          await ensureParents(w, project, creating.parent)
          const res = await api().wikiCreatePage(org(), project.name, w.id, creating.parent, creating.name, content, wikiVersion(w))
          if (get().path === path) set({ path: res.path })
          after({ path: res.path, content, version: res.version, remoteUrl: null })
          write(`wiki.page.${w.id}`, res.path)
          markSeen(w, res.path)
          void get().reloadTree()
          toast({ kind: 'success', title: 'Page added', detail: res.path })
        } else {
          const res = await api().wikiSave(org(), project.name, w.id, page.path, content, page.version ?? '', wikiVersion(w))
          after({ ...page, content, version: res.version })
          markSeen(w, page.path)
          toast({ kind: 'success', title: 'Page saved' })
        }
        return true
      } catch (e) {
        toast({
          kind: 'error',
          title: creating ? 'Could not add the page' : 'Could not save the page',
          detail: errorMessage(e),
          sticky: true,
          action: { label: 'Copy my text', onClick: () => void navigator.clipboard.writeText(draft) },
        })
        return false
      } finally {
        set({ saving: false })
      }
    },

    createPage: async (parent, name, content) => {
      const { project, path } = get()
      const w = wiki(get())
      const problem = pageNameProblem(name)
      if (!project || !w) return false
      if (problem) { toast({ kind: 'error', title: problem }); return false }
      const target = `${parent === '/' ? '' : parent}/${name.trim()}`
      if (flattenPages(get().tree).includes(target)) { toast({ kind: 'error', title: 'A page with that name is already there', detail: 'Pick another name, or open that page.' }); return false }
      if (!(await canLeave())) return false
      set({
        creating: { parent, name: name.trim(), back: get().creating?.back ?? path },
        path: target,
        page: { path: target, content: '', version: null, remoteUrl: null },
        pageError: null,
        pageLoading: false,
        draft: content ?? `# ${name.trim()}\n\n`,
        clean: null,
        search: null,
      })
      return true
    },

    createWiki: async () => {
      const { project } = get()
      if (!project) return
      set({ loading: true, error: null })
      try {
        const w = await api().wikiCreate(org(), project.name, project.id)
        set({ wikis: [w], wikiId: w.id })
        restoreSeen(w)
        await get().reloadTree()
      } catch (e) {
        set({ error: errorMessage(e) })
      } finally {
        set({ loading: false })
      }
    },

    runSearch: async (text) => {
      const { project } = get()
      if (!project || !text.trim()) return
      set({ search: { text, result: null, loading: true } })
      try {
        const result = await api().wikiSearch(org(), project.name, text.trim())
        if (get().search?.text === text) set({ search: { text, result, loading: false } })
      } catch (e) {
        if (get().search?.text === text) set({ search: null })
        toast({ kind: 'error', title: 'Could not search the wiki', detail: errorMessage(e) })
      }
    },
    clearSearch: () => set({ search: null }),

    loadMentions: (ids) => {
      const { project, mentions } = get()
      const todo = ids.filter((id) => !(id in mentions)).slice(0, 40)
      if (!project || todo.length === 0) return
      set({ mentions: { ...mentions, ...Object.fromEntries(todo.map((id) => [id, null])) } })
      const types = typesOf(project.name)
      for (const id of todo) {
        Promise.all([api().getWorkItem(org(), project.name, id), types]).then(([w, ts]) => {
          const type = String(w.fields['System.WorkItemType'] ?? '')
          const state = String(w.fields['System.State'] ?? '')
          const item = { title: String(w.fields['System.Title'] ?? ''), type, state, done: isDone(ts, type, state) }
          set((s) => ({ mentions: { ...s.mentions, [id]: item } }))
        }).catch(() => { /* stays a plain #id link */ })
      }
    },

    createTasks: async () => {
      const { project, page, people } = get()
      const w = wiki(get())
      if (!project || !w || !page || get().makingTasks) return 0
      const text = get().draft ?? page.content
      const todo = newActions(text, people)
      if (todo.length === 0) {
        toast({ kind: 'info', title: 'No new actions on this page', detail: 'Write them as "- [ ] @Name what to do". Lines that already have a #work item are left alone.' })
        return 0
      }
      set({ makingTasks: true })
      const made: { raw: string; id: number }[] = []
      const where = page.remoteUrl ? `<a href="${esc(page.remoteUrl)}">${esc(page.path)}</a>` : esc(page.path)
      try {
        for (const a of todo) {
          const owner = actionOwner(a.text, people)
          const fields: Record<string, unknown> = { 'System.Title': taskTitle(a.text, people), 'System.Description': `<p>An action from the wiki page ${where}.</p>` }
          if (owner) fields['System.AssignedTo'] = owner.uniqueName || owner.displayName
          try {
            const it = await api().createWorkItem(org(), project.name, 'Task', fields, null)
            made.push({ raw: a.raw, id: it.id })
          } catch (e) {
            toast({ kind: 'error', title: 'Could not create a task', detail: `${taskTitle(a.text, people)}: ${errorMessage(e)}` })
            break
          }
        }
        if (made.length === 0) return 0
        const ids = made.map((m) => `#${m.id}`).join(', ')
        if (get().draft !== null && get().path === page.path) {
          set({ draft: linkTasks(get().draft!, made) })
        } else {
          try {
            await rewrite(page.path, (content) => linkTasks(content, made))
          } catch (e) {
            toast({ kind: 'error', title: 'The tasks were created, but the page could not be updated', detail: `Add ${ids} to their lines. ${errorMessage(e)}`, sticky: true })
            return made.length
          }
        }
        toast({ kind: 'success', title: `Created ${made.length} task${made.length === 1 ? '' : 's'}`, detail: ids })
        get().loadMentions(made.map((m) => m.id))
        return made.length
      } finally {
        set({ makingTasks: false })
      }
    },

    linkItem: async (id, heading = 'Became') => {
      const placeholder = /^(Not linked yet\.?|The User Need or Requirement this became.*)$/i
      const add = (content: string) => (mentionedIds(sectionText(content, heading)).includes(id) ? content : appendToSection(content, heading, `- #${id}`, placeholder))
      if (get().draft !== null) {
        set({ draft: add(get().draft!) })
        return true
      }
      const path = get().page?.path
      if (!path) return false
      try {
        await rewrite(path, add)
        get().loadMentions([id])
        toast({ kind: 'success', title: `Linked #${id}` })
        return true
      } catch (e) {
        toast({ kind: 'error', title: 'Could not link it', detail: errorMessage(e) })
        return false
      }
    },

    notesFor: async (booking, room) => {
      const project = await wikiProject()
      if (!project) { toast({ kind: 'error', title: 'Pick a project first', detail: 'Meeting notes go in the project’s wiki.' }); return }
      useUiStore.getState().setView('wiki')
      await get().load(project)
      const w = wiki(get())
      if (!w || !get().tree) return
      const start = new Date(booking.start_dt)
      const end = new Date(booking.end_dt)
      const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      await get().startMeeting(booking.title || 'Meeting', { date: isoDay(start), time: booking.all_day ? null : `${clock(start)}–${clock(end)}`, room, organizer: booking.who ?? null })
    },

    startMeeting: async (title, opts = {}) => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return false
      const topic = title.replace(/[/\\#]/g, '-').trim() || 'Meeting'
      const date = opts.date ?? isoDay()
      const name = `${date} ${topic}`
      const path = `${MEETINGS}/${name}`
      if (flattenPages(get().tree).includes(path)) { await get().open(path); return true }
      // The last meeting on the same topic: its open actions come along.
      const sameTopic = (p: string) => pageTitle(p).replace(/^\d{4}-\d{2}-\d{2}\s+/, '').toLowerCase() === topic.toLowerCase()
      const before = childPages(get().tree, MEETINGS).filter((p) => sameTopic(p) && pageTitle(p).slice(0, 10) < date).sort().pop() ?? null
      let carried: ReturnType<typeof parseActions> = []
      if (before) {
        try {
          const prev = await api().wikiPage(org(), project.name, w.id, before, wikiVersion(w))
          carried = parseActions(editable(prev.content)).filter((a) => !a.done && !/^@Name what to do\b/.test(a.text))
        } catch { /* start without them */ }
      }
      const content = meetingNotes({ title: topic, date, time: opts.time, room: opts.room, organizer: opts.organizer ?? useAppStore.getState().account()?.userName ?? null, carried, carriedFrom: before })
      return get().createPage(MEETINGS, name, content)
    },

    show: async (path, wikiId) => {
      const project = await wikiProject()
      if (!project) return
      useUiStore.getState().setView('wiki')
      await get().load(project)
      if (wikiId && wikiId !== get().wikiId && get().wikis.some((w) => w.id === wikiId)) await get().selectWiki(wikiId)
      await get().open(path)
    },

    loadChanges: async () => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return
      const since = new Date(Date.now() - CHANGES_DAYS * 86400000).toISOString()
      try {
        const changes = await api().wikiChanges(org(), project.name, w.repositoryId, wikiBranch(w), w.mappedPath ?? null, since)
        if (wiki(get())?.id !== w.id) return
        set({ changes })
        const me = useAppStore.getState().account()
        if (!me?.userId) return
        const others = changes.filter((c) => !isMe(c)).slice(0, 15)
        const hits: WikiMention[] = []
        await Promise.all(others.map(async (c) => {
          const key = `${w.id}${c.path}@${c.date}`
          if (!mentionScan.has(key)) {
            const page = await api().wikiPage(org(), project.name, w.id, c.path, wikiVersion(w)).catch(() => null)
            mentionScan.set(key, !!page && mentionsOf(page.content, me.userId))
          }
          if (mentionScan.get(key)) hits.push({ path: c.path, by: c.author, date: c.date })
        }))
        if (wiki(get())?.id === w.id) set({ mentionsOfMe: hits.sort((a, b) => b.date.localeCompare(a.date)) })
      } catch {
        // Older servers or a token without code read: the wiki works without this list.
        if (wiki(get())?.id === w.id) set({ changes: [] })
      }
    },

    refreshFor: async (project) => {
      if (get().project?.id !== project.id) {
        // Never in the way of an unsaved page.
        if (get().draft !== null) return
        await get().load(project)
      } else {
        await get().loadChanges()
      }
    },
  }
})
